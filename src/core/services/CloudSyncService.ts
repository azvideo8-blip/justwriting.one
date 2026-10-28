import { DocumentService, UnreadableCloudListError, UnreadableCloudRowError, parseCloudDocument } from './DocumentService';
import { readCloudDocumentsPartial } from './cloudListPartial';
import { pullChangesSince } from '../data/providers/pullChanges';
import { DOCUMENT_REV, fromDb } from '../data/providers/fields';
import { advanceSyncRevCursor, getSyncRevCursor, getSyncRevDeferred, setSyncRevDeferred } from '../sync/revCursor';
import { requeueDocumentTask, quarantineDocumentTask } from '../sync/requeueDocumentTask';
import { VersionService } from './VersionService';
import { LocalStorageService } from './LocalStorageService';
import { syncStatusOf } from '../sync/syncStatus';
import { isPoisonSyncError } from '../sync/classifySyncError';
import { LocalDocumentService } from './LocalDocumentService';
import { LocalVersionService } from './LocalVersionService';
import { getLocalDb, type LocalDocument, randomUUID } from '../storage/localDb';
import { Document } from '../../types';
import { toDate } from '../utils/dateUtils';
import { maybeEncrypt, maybeDecrypt, DecryptionError, type VersionEncryptPayload, getEncryptionEnabled } from '../crypto/cryptoHelpers';
import { getSessionKey } from '../crypto/encrypt';
import { reportError } from '../../shared/errors/reportError';
import { withTimeout as withTimeoutBase, TimeoutError } from '../../shared/utils/withTimeout';

import { DataProvider } from '../data';

import { SaveDocumentData } from './storageTypes';
import { ConflictResolver } from './ConflictResolver';
import { useActivityLogStore } from '../../shared/activity/useActivityLogStore';
import { computeWordDelta } from './DiffService';
import { comparableOrUnknown } from '../sync/comparableOrUnknown';
import { oweSessionDuration, owedSessionDuration, settleSessionDuration } from './pendingDuration';
import { emitDomainEvent } from '../events/domainEvents';

/**
 * W-6, исход упавшей выгрузки. Таймаут вызова счётчиков — «не дождались», а не
 * «не легло»: сервер мог дельту применить, и досылка её удвоила бы. Такой вызов
 * считаем прошедшим и гасим отправленный долг.
 * ponytail: недосчёт при редком таймауте вместо двойного счёта; точный ответ —
 * ключ идемпотентности в sync_document_stats.
 * Любая другая ошибка — секунды версий, уже лёгших в облако, висят долгом.
 */
function settleOrOweAfterFailure(
  e: unknown, statsInFlight: boolean, uid: string, docId: string, owed: number, uploaded: number,
): void {
  if (statsInFlight && e instanceof TimeoutError) settleSessionDuration(uid, docId, owed);
  else oweSessionDuration(uid, docId, uploaded);
}
import { withDocumentLock } from '../sync/withDocumentLock';
import { logger } from '../../shared/errors/logger';
import pLimit from 'p-limit';

import { getActiveEditorDocumentId } from '../sync/activeEditor';

const _activeDownloadPromises = new Map<string, Promise<{ downloaded: number; skipped: number; failed: number; locked?: boolean }>>();
// Итог сверки связанных заметок. `corrupted` — сколько облачных версий не
// прочитались; это НЕ `failed`: на `failed` встаёт курсор изменений.
export interface ReconcileSummary {
  reconciled: number;
  skipped: number;
  failed: number;
  corrupted: number;
  locked?: boolean;
  /** R-2: список облака был неполным — сверено только по прочитанной части; курсор не двигать. */
  incomplete?: boolean;
}

const _activeReconcilePromises = new Map<string, Promise<ReconcileSummary>>();
const downloadLimit = pLimit(5);

// S1-6: один забор по rev на пользователя за раз — второй вызывающий
// присоединяется к идущему, как у downloadAllFromCloud.
export interface PullNotesResult {
  /** S1-12: сколько строк отложено после этого забора (стойко нечитаемые). */
  deferred: number;
  downloaded: number;
  reconciled: number;
  skipped: number;
  corrupted: number;
  failed: number;
  locked?: boolean;
  documentsRev: number;
  versionsRev: number;
}
const _activePullPromises = new Map<string, Promise<PullNotesResult>>();
const PULL_PAGE_SIZE = 1000;

export interface RelinkResult {
  relinked: number;
  skippedIds: string[];
}

export const CLOUD_COPY_LOCAL_ONLY = 'LOCAL_ONLY';
export const CLOUD_COPY_TOMBSTONE = 'TOMBSTONE';

const CLOUD_SYNC_TIMEOUT = 30_000;

/**
 * S0-4 (Fable §1.1): отметка «до какой облачной версии выгружен этот ряд»
 * берётся С СЕРВЕРА, а не с часов устройства.
 *
 * `lastSeenCloudUpdatedAt` сравнивается с серверным `updated_at` при сверке
 * (`reconcileLinkedDocuments`, `:274`). Прежним кодом после выгрузки туда
 * ставился `new Date().toISOString()`, то есть local time: устройство с часами
 * вперёд объявляло своё же облако устаревшим, и правка с другого устройства не
 * приезжала, пока часы не поправят.
 *
 * Не прочитали серверную метку — поле НЕ перезаписывается: «не знаю» для `:274`
 * означает «суди по номеру версии», а «сутки вперёд» означает «не приезжает
 * никогда». Молчать об этом нельзя, поэтому — warning.
 */
async function markCloudSeen(
  userId: string,
  localDocumentId: string,
  cloudId: string,
  // null — номер выгруженной версии берём из самого ряда: так делал этот проход
  // до правки, и две его точки различались именно формой записи счётчика.
  syncedVersion: number | null,
  context: string,
  // SF-7: метка, которую сервер отдал на НАШЕЙ записи. Если она есть, рядом
  // ничего читать не нужно: перечитывание ряда после записи ловит в этом окне
  // чужую запись и принимает её за свою — после чего локальный ряд «видел»
  // версию, которой не видел, и сверка изменений (`:274`) чужую правку больше
  // не зовёт. Нет метки в ответе (фолбэк ветки с надгробием) — прежний путь.
  writtenUpdatedAt: number | null = null,
): Promise<void> {
  let serverIso: string | null = null;
  /*gate:clock-rule*/
  // Решение «какой меткой считать облако»: ответ собственной записи, иначе
  // перечитывание ряда, иначе ничего. Часов прибора здесь быть не должно — гейт
  // (S0-6, SF-9) следит за всем блоком, а не за одной строкой.
  // `rowMissing` — перечитывание не отдало строку вовсе (ряд снесли во время
  // записи). Row без `updated_at` в проде быть не может (`0001`/`0028`:
  // not null default now()), поэтому отдельного отчёта на него нет — метку всё
  // равно не отравляем часовым значением.
  let rowMissing = false;
  if (writtenUpdatedAt !== null && Number.isFinite(writtenUpdatedAt)) {
    serverIso = new Date(writtenUpdatedAt).toISOString();
  } else try {
    // Живой ряд, не «с надгробиями»: нам нужна серверная метка версии,
    // которую сервер только что принял.
    const cloud = await DocumentService.getDocument(userId, cloudId);
    rowMissing = cloud == null;
    const raw = cloud?.updatedAt ?? cloud?.createdAt ?? null;
    if (typeof raw === 'string' || typeof raw === 'number' || raw instanceof Date) {
      const ms = raw instanceof Date ? raw.getTime() : (typeof raw === 'number' ? raw : Date.parse(raw));
      if (Number.isFinite(ms)) serverIso = new Date(ms).toISOString();
    }
  } catch (e) {
    reportError(e, { action: 'markCloudSeen_read', cloudId, documentId: localDocumentId, context }, 'warning');
  }
  /*endgate:clock-rule*/

  try {
    const db = await getLocalDb(userId);
    const tx = db.transaction('documents', 'readwrite');
    const cur = await tx.store.get(localDocumentId);
    if (cur) {
      await tx.store.put({
        ...cur,
        lastSyncedCloudVersion: syncedVersion ?? cur.currentVersion,
        ...(serverIso !== null ? { lastSeenCloudUpdatedAt: serverIso } : {}),
      });
    }
    await tx.done;
  } catch (e) {
    // Заметка в облаке есть; не записалась только отметка «до какой версии
    // выгружено» — следующий проход выгрузит лишний раз. Не сбой, но видно.
    reportError(e, { action: 'addCloudCopy_markSynced', documentId: localDocumentId, cloudId, context }, 'warning');
    return;
  }

  if (serverIso === null && rowMissing) {
    reportError(
      new Error('Cloud row unreadable after upload — lastSeenCloudUpdatedAt left as is, not set from the device clock'),
      { action: 'markCloudSeen_noServerStamp', cloudId, documentId: localDocumentId, context },
      'warning',
    );
  }
}

/**
 * Снять задачи очереди, относящиеся к заметке.
 *
 * Правило одно: задача принадлежит заметке, если совпал её documentId или это
 * задача с именем `sync_<id>`. Раньше оно жило тремя копиями в этом файле, и
 * копии успели разойтись — одна из них знала только про documentId.
 */
async function dropQueueTasksFor(localDocumentId: string, ownerId?: string): Promise<void> {
  try {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction('syncQueue', 'readwrite');
    const all = await tx.store.getAll();
    for (const t of all) {
      // Строка замка — не задача очереди. Снять её внутри критической секции
      // значит выпустить в неё вторую вкладку: heartbeat обновляет только строку
      // со своим ownerToken, так что замок назад не появится.
      if (t.id.startsWith('lock_cloud_')) continue;
      if (t.documentId === localDocumentId || t.id === `sync_${localDocumentId}`) {
        await tx.store.delete(t.id);
      }
    }
    await tx.done;
  } catch (e) {
    // Очередь переживёт лишнюю задачу, потеря заметки — нет, поэтому падение
    // не роняет вызывающего. Но застрявшая задача должна быть видна, а не
    // молча липнуть к следующей синхронизации.
    reportError(e, { action: 'dropQueueTasksFor' }, 'warning');
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number = CLOUD_SYNC_TIMEOUT): Promise<T> {
  return withTimeoutBase(promise, ms, 'Sync timeout');
}



type ReconcileOneOutcome = 'reconciled' | 'skipped' | 'failed' | 'busy';

/**
 * S1-11: замок заметки занят (выгрузка в другой вкладке). Для забора по rev
 * это «не применено»: строка не пройдена, курсор встаёт перед ней, забор
 * заканчивается без ошибки — следующий проход начнёт с неё.
 */
class PullPaused extends Error {
  constructor(readonly uuid: string) {
    // Без шаблонной строки: инвентарь ключей аккаунта читает `${…}` рядом с
    // localStorage как ключ (accountScopedKeys.inventory).
    super('PULL_PAUSED: document is locked by another writer: ' + uuid);
    this.name = 'PullPaused';
  }
}

/**
 * S1-12: отказ, который повторится на той же строке при любом следующем
 * чтении — схема, расшифровка, заметка без версий. Такую строку забор
 * откладывает и идёт дальше. Всё остальное (сеть, LOCKED, замок, сбой
 * записи) — стоп на этой строке, как раньше: оно может пройти само.
 */
function deterministicPullFailure(e: unknown): string | null {
  if (e instanceof UnreadableCloudRowError) return 'schema';
  const msg = String((e as { message?: string } | null)?.message ?? e);
  for (const prefix of ['DECRYPTION_ERROR', 'EMPTY_CLOUD_DOCUMENT', 'DECRYPT_FAILED_LATEST']) {
    if (msg.startsWith(prefix)) return prefix;
  }
  return null;
}

/**
 * S1-6: сверка ОДНОЙ связанной заметки — одно правило на два входа.
 *
 * Старый полный проход (`reconcileLinkedDocuments`) зовёт её в цикле по всем
 * связанным заметкам, новый забор по `rev` — только по тем, чей номер приехал.
 * Правило «облако новее» (`isCloudNewer`) не меняется: это этап 3.
 */
async function reconcileOneLinked(
  userId: string,
  localDoc: LocalDocument,
  cloudDoc: Document,
  opts?: { getActiveDocumentId?: () => string | null },
): Promise<{ outcome: ReconcileOneOutcome; corrupted: number }> {
  const cloudTime = cloudDoc.updatedAt ? new Date(cloudDoc.updatedAt).getTime() : (cloudDoc.createdAt ? new Date(cloudDoc.createdAt).getTime() : 0);
  const localSeenTime = localDoc.lastSeenCloudUpdatedAt ? new Date(localDoc.lastSeenCloudUpdatedAt).getTime() : 0;

  /*gate:clock-rule*/
  // Всё правило «облако новее» — под разметкой (SF-9): и решение по запомненной
  // серверной метке, и запасной путь по `lastSessionAt`/номеру версии. Гейт —
  // src/test/syncRuleGates.s06.test.ts (S0-6).
  const isCloudNewer = localSeenTime > 0
    ? cloudTime > localSeenTime
    : (cloudDoc.currentVersion > (localDoc.lastSyncedCloudVersion ?? localDoc.currentVersion) ||
       (cloudTime > (localDoc.lastSessionAt || 0) && cloudDoc.currentVersion >= localDoc.currentVersion));
  /*endgate:clock-rule*/

  if (!isCloudNewer) return { outcome: 'skipped', corrupted: 0 };

  let outcome: ReconcileOneOutcome = 'skipped';
  let corrupted = 0;
  try {
    await withDocumentLock(localDoc.id, async () => {
      const db = await getLocalDb(userId);
      const fresh = await db.get('documents', localDoc.id);
      if (!fresh) {
        return;
      }

      const freshQueue = await db.getAll('syncQueue');
      const docUuid = fresh.uuid;
      const linkedCloudId = fresh.linkedCloudId;
      const hasQueueTask = freshQueue.some(
        t => !t.id.startsWith('lock_cloud_') && (
          t.documentId === localDoc.id ||
          (Boolean(docUuid) && t.documentId === docUuid) ||
          (Boolean(linkedCloudId) && t.documentId === linkedCloudId)
        )
      );

      const activeEditorDocId = opts?.getActiveDocumentId ? opts.getActiveDocumentId() : getActiveEditorDocumentId();
      const hasUnsyncedEdits = fresh.lastSyncedCloudVersion !== undefined &&
        (fresh.currentVersion ?? 0) > fresh.lastSyncedCloudVersion;

      const isPending = hasQueueTask || (activeEditorDocId === localDoc.id) || hasUnsyncedEdits;

      if (hasUnsyncedEdits) {
        await requeueDocumentTask(localDoc.id, userId);
      }

      const cloudVersions = await VersionService.getVersions(userId, localDoc.linkedCloudId!);
      if (!cloudVersions.length) {
        return;
      }

      // R3-010: без отметки синхронизации (заметки, связанные старыми
      // версиями приложения) правки нельзя ни подтвердить, ни исключить.
      // Прежде такая заметка шла в перемотку: счётчики вставали на голову
      // облака, а локальная v2 с другим текстом объявлялась синхронизированной.
      // Перемотка безопасна, только если текст совпадает с головой облака;
      // иначе — как при правках: облачная голова ложится поверх, локальная
      // остаётся в истории.
      let unknownWatermarkDiverged = false;
      if (!isPending && fresh.lastSyncedCloudVersion === undefined) {
        const head = cloudVersions.reduce((latest, v) => (v.version > latest.version ? v : latest), cloudVersions[0]!);
        let headContent: string | null = null;
        try {
          const dec = await maybeDecrypt(head as unknown as Record<string, unknown>, ['content'], []);
          headContent = typeof dec.content === 'string' ? dec.content : null;
        } catch (decErr) {
          if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
          if (!(decErr instanceof DecryptionError)) throw decErr;
        }
        const localContent = await LocalVersionService.getLatestContent(localDoc.id, userId);
        unknownWatermarkDiverged = localContent !== '' && localContent !== headContent;
      }

      const cloudUpdatedAtIso = cloudDoc.updatedAt
        ? new Date(cloudDoc.updatedAt).toISOString()
        : new Date(cloudTime || Date.now()).toISOString();

      if (isPending || unknownWatermarkDiverged) {
        const latestCloudVer = cloudVersions.reduce((latest, v) => (v.version > latest.version ? v : latest), cloudVersions[0]!);

        let plainContent: string | null = null;
        let plainMood: string | undefined = undefined;
        try {
          const decrypted = await maybeDecrypt(latestCloudVer as unknown as Record<string, unknown>, ['content', 'mood'], []);
          plainContent = typeof decrypted.content === 'string' ? decrypted.content : null;
          plainMood = typeof decrypted.mood === 'string' ? decrypted.mood : (typeof latestCloudVer.mood === 'string' ? latestCloudVer.mood : undefined);
        } catch (decErr) {
          if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
          if (!(decErr instanceof DecryptionError)) throw decErr;
          // R3-023: голова облака не читается — счётчики не трогаем
          // (ветка ниже пропускается), но и не молчим.
          corrupted++;
          reportError(decErr, {
            action: 'reconcileLinkedDocuments_unreadableHead',
            documentId: localDoc.id,
            cloudDocumentId: localDoc.linkedCloudId,
            version: latestCloudVer.version,
          }, 'warning');
        }

        if (plainContent !== null) {
          const localVersions = await LocalVersionService.getVersions(localDoc.id, userId);
          const nextVersionNo = Math.max(...localVersions.map(v => v.version), 0) + 1;

          const tx = db.transaction(['documents', 'versions'], 'readwrite');
          const docStore = tx.objectStore('documents');
          const verStore = tx.objectStore('versions');

          const cur = await docStore.get(localDoc.id);
          // Номер берётся и по строкам истории, и по счётчику заметки: строки
          // могут отстать (историю чистят LocalVersionService.deleteVersions), и
          // тогда nextVersionNo откатил бы currentVersion назад — вместе с
          // признаком "есть что отправить" из A-2.3.
          const versionNo = Math.max(nextVersionNo, cur?.currentVersion ?? 0);
          const verId = 'ver_' + randomUUID();

          await verStore.put({
            id: verId,
            documentId: localDoc.id,
            guestId: userId,
            version: versionNo,
            content: plainContent,
            wordCount: latestCloudVer.wordCount ?? 0,
            wordsAdded: 0,
            charsAdded: 0,
            duration: latestCloudVer.duration ?? 0,
            wpm: latestCloudVer.wpm ?? 0,
            goalWords: latestCloudVer.goalWords,
            goalTime: latestCloudVer.goalTime,
            goalReached: latestCloudVer.goalReached ?? false,
            sessionStartedAt: latestCloudVer.sessionStartedAt ? toDate(latestCloudVer.sessionStartedAt)?.getTime() ?? Date.now() : Date.now(),
            savedAt: latestCloudVer.savedAt ? toDate(latestCloudVer.savedAt)?.getTime() ?? Date.now() : Date.now(),
            mood: plainMood,
          });

          if (cur) {
            await docStore.put({
              ...cur,
              currentVersion: versionNo,
              lastSeenCloudUpdatedAt: cloudUpdatedAtIso,
            });
          }
          await tx.done;

          useActivityLogStore.getState().addActivity(
            'activity_cloud_remote_edit',
            { action: 'reconcileLinkedDocuments_remote_edit', documentId: localDoc.id, cloudDocumentId: localDoc.linkedCloudId },
            'info',
            'sync',
          );

          outcome = 'reconciled';
        }
      } else {
        const localVersions = await LocalVersionService.getVersions(localDoc.id, userId);
        const localVerSet = new Set(localVersions.map(v => v.version));

        const sortedCloudVersions = [...cloudVersions].sort((a, b) => a.version - b.version);
        let prevContent = '';
        const corruptedVersions: number[] = [];
        for (const cv of sortedCloudVersions) {
          let cContent: string | null = null;
          let cMood: string | undefined = undefined;
          try {
            const dec = await maybeDecrypt(cv as unknown as Record<string, unknown>, ['content', 'mood'], []);
            cContent = typeof dec.content === 'string' ? dec.content : null;
            cMood = typeof dec.mood === 'string' ? dec.mood : (typeof cv.mood === 'string' ? cv.mood : undefined);
          } catch (decErr) {
            if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
            if (!(decErr instanceof DecryptionError)) throw decErr;
            corruptedVersions.push(cv.version);
          }

          if (cContent !== null) {
            if (!localVerSet.has(cv.version)) {
              await LocalVersionService.addVersion(userId, localDoc.id, {
                content: cContent,
                previousContent: prevContent,
                wordCount: cv.wordCount ?? 0,
                duration: cv.duration ?? 0,
                wpm: cv.wpm ?? 0,
                versionNumber: cv.version,
                goalWords: cv.goalWords,
                goalTime: cv.goalTime,
                goalReached: cv.goalReached,
                sessionStartedAt: cv.sessionStartedAt ? toDate(cv.sessionStartedAt) ?? new Date() : new Date(),
                savedAt: cv.savedAt ? toDate(cv.savedAt) ?? undefined : undefined,
                mood: cMood,
              });
            }
            prevContent = cContent;
          }
        }

        // R4-005: у облачного ряда current_version мог отстать от
        // фактически скачанных версий (расхождение счётчиков) —
        // записывать отставший счётчик значило прятать хвост истории
        // за «синхронизировано». Берём максимум из увиденного.
        const seenMaxVersion = Math.max(
          cloudDoc.currentVersion,
          ...sortedCloudVersions.map(cv => cv.version),
        );

        // R7F-010: заметку скрыли или выбросили на другом устройстве — флаг
        // приехал этим забором, а доменное событие здесь никогда не эмитилось,
        // поэтому производные (хронология, цитаты тем, линии) жили на этом
        // устройстве бессрочно. Признак считается локально, без импорта из
        // features: ядро не знает про ИИ, только про шину событий.
        const cloudTrashedAtMs = toDate((cloudDoc as { trashedAt?: unknown }).trashedAt)?.getTime() ?? null;
        const wasExcluded = Boolean(localDoc.excludedFromAI) || Boolean(localDoc.trashedAt);
        const nowExcluded = Boolean(cloudDoc.excludedFromAI ?? localDoc.excludedFromAI) || Boolean(cloudTrashedAtMs);

        await LocalStorageService.updateDocument(localDoc.id, {
          title: cloudDoc.title ?? localDoc.title,
          tags: cloudDoc.tags ?? localDoc.tags,
          labelId: cloudDoc.labelId !== undefined ? (cloudDoc.labelId ?? undefined) : localDoc.labelId,
          mood: cloudDoc.mood ?? localDoc.mood,
          currentVersion: seenMaxVersion,
          totalWords: cloudDoc.totalWords ?? localDoc.totalWords,
          totalDuration: cloudDoc.totalDuration ?? localDoc.totalDuration,
          sessionsCount: cloudDoc.sessionsCount ?? localDoc.sessionsCount,
          lastSyncedCloudVersion: seenMaxVersion,
          lastSeenCloudUpdatedAt: cloudUpdatedAtIso,
          excludedFromAI: cloudDoc.excludedFromAI ?? localDoc.excludedFromAI,
          // R3-5: корзина на другом устройстве (и восстановление из неё) —
          // облако новее, значит его состояние корзины и есть последнее.
          trashedAt: cloudTrashedAtMs,
        }, userId);

        if (!wasExcluded && nowExcluded) {
          emitDomainEvent({ type: 'note.excludedFromAI', documentId: localDoc.id, excluded: true });
        }

        // A-4 (R2-004): версия не читается — в локальную историю её дыра.
        // Воду метку всё равно поднимаем (иначе эта версия не прочитается
        // никогда), но молчать нельзя: без записи заметка выглядит
        // синхронизированной целиком.
        if (corruptedVersions.length > 0) {
          corrupted += corruptedVersions.length;
          reportError(
            new Error(`Skipped ${corruptedVersions.length} unreadable version(s) while reconciling a note`),
            {
              action: 'reconcileLinkedDocuments_corruptedVersions',
              documentId: localDoc.id,
              cloudDocumentId: localDoc.linkedCloudId,
              versions: corruptedVersions.join(','),
            },
            'warning',
          );
          useActivityLogStore.getState().addActivity(
            'activity_cloud_corrupted_versions',
            { action: 'reconcileLinkedDocuments_corruptedVersions', cloudDocumentId: localDoc.linkedCloudId, count: corruptedVersions.length },
            'warning',
            'sync',
          );
        }

        outcome = 'reconciled';
      }
    }, { queueOnHeld: false, ownerId: userId });
  } catch (err) {
    const msg = String((err as { message?: string })?.message || err);
    if (msg.startsWith('LOCK_HELD') || msg.includes('LOCK_HELD')) {
      // S1-11: занятый замок — не «пропущено как неновое», а «не применено».
      return { outcome: 'busy', corrupted: 0 };
    }
    reportError(err, { action: 'reconcileLinkedDocuments_doc', docId: localDoc.id });
    return { outcome: 'failed', corrupted: 0 };
  }
  return { outcome, corrupted };
}

export const CloudSyncService = {
  async restoreMissingDocuments(
    userId: string,
    opts?: { force?: boolean; onProgress?: (current: number, total: number) => void },
  ): Promise<{ restored: number; hasMore: boolean; locked?: boolean; throttled?: boolean }> {
    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      return { restored: 0, hasMore: false, locked: true };
    }

    if (!opts?.force) {
      const lastListingTs = parseInt(localStorage.getItem(`last_restore_listing_ts_${userId}`) || '0', 10);
      if (Date.now() - lastListingTs < 30 * 60 * 1000) {
        return { restored: 0, hasMore: false, throttled: true };
      }
    }
    
    // We update the timestamp only if we are actually going to list.
    localStorage.setItem(`last_restore_listing_ts_${userId}`, Date.now().toString());

    const res = await CloudSyncService.downloadAllFromCloud(userId, opts?.onProgress ? { onProgress: opts.onProgress } : undefined);
    return {
      restored: res.downloaded,
      // R-2: неполный список — не всё скачано; суточная отметка полного прохода не ставится.
      hasMore: res.incomplete === true,
      ...(res.locked !== undefined ? { locked: res.locked } : {}),
    };
  },

  /**
   * S-1: one download at a time per user, whichever entry point started it
   * (auth mount, online recovery, vault unlock, the settings button, the daily
   * background restore). A second caller joins the running promise.
   */
  async downloadAllFromCloud(
    userId: string,
    opts?: { onProgress?: (current: number, total: number) => void }
  ): Promise<{ downloaded: number; skipped: number; failed: number; locked?: boolean; incomplete?: boolean }> {
    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      return { downloaded: 0, skipped: 0, failed: 0, locked: true };
    }

    const active = _activeDownloadPromises.get(userId);
    if (active) return active;

    const run = async () => {
      // S-2: Do NOT catch relinkOrphanedDocuments error here. A download that could not relink must stop.
      await CloudSyncService.relinkOrphanedDocuments(userId);

      const [cloudList, localDocs] = await Promise.all([
        readCloudDocumentsPartial(userId),
        LocalStorageService.getDocumentsByOwner(userId),
      ]);
      const cloudDocs = cloudList.docs;
      // R-2: один битый ряд не превращает список в пустой — прочитанные заметки
      // качаем; решения «по отсутствию» (TB-14) по неполному списку не принимаем.
      const incomplete = cloudList.unreadable.length > 0;
      if (incomplete) {
        reportError(new Error(`UNREADABLE_CLOUD_LIST: ${cloudList.unreadable.length} row(s)`), { action: 'downloadAllFromCloud_partialList', userId, unreadable: cloudList.unreadable.length }, 'warning');
      }

      // TB-14: связанная заметка, которой нет среди живых строк облака, либо
      // удалена там (надгробие), либо сервер её потерял, хотя подтвердил. Раньше
      // её просто не замечали — устройство вечно считало её синхронизированной.
      // Разбирается addCloudCopy: надгробие → отвязка с предупреждением, пропажа →
      // выгрузка заново под тем же номером. Только по полному списку: при
      // неполном «нет в списке» может быть нечитаемой строкой.
      const cloudIds = new Set(cloudDocs.map(d => d.id));
      if (!incomplete) {
        for (const d of localDocs) {
          if (d.linkedCloudId && d.localOnly !== true && !cloudIds.has(d.linkedCloudId)) {
            await requeueDocumentTask(d.id, userId);
          }
        }
      }

      const linkedCloudMap = new Map(localDocs.filter(d => d.linkedCloudId).map(d => [d.linkedCloudId!, d]));
      const localUuidSet = new Set(localDocs.map(d => d.uuid).filter(Boolean));
      // S-2: The uuid check is the second line of defence. It does not cover documents
      // created before UUID backfill; for those, relinkOrphanedDocuments above is the sole protection.
      const toDownload = cloudDocs.filter(d => !linkedCloudMap.has(d.id) && (!d.uuid || !localUuidSet.has(d.uuid)));
      let skipped = cloudDocs.length - toDownload.length;

      const downloadResults = await Promise.allSettled(
        toDownload.map((cloudDoc, idx) => downloadLimit(async () => {
          opts?.onProgress?.(idx + 1, toDownload.length);
          return CloudSyncService.addLocalCopy(userId, cloudDoc.id);
        }))
      );

      let downloaded = 0;
      let failed = 0;
      for (const r of downloadResults) {
        if (r.status === 'fulfilled') downloaded++;
        else {
          const reasonStr = String((r.reason as { message?: string })?.message || r.reason);
          if (reasonStr.startsWith('LOCK_HELD') || reasonStr.includes('LOCK_HELD')) {
            skipped++;
            logger.info('downloadAllFromCloud', 'Download already in progress in another tab', { reason: reasonStr });
          } else {
            failed++;
            logger.error('downloadAllFromCloud', 'Download failed', { reason: String(r.reason) });
          }
        }
      }

      if (downloaded > 0) {
        useActivityLogStore.getState().addActivity(
          'activity_cloud_downloaded_all',
          { action: 'downloadAllFromCloud', downloaded, skipped, failed },
          'info',
          'sync'
        );
      }

      return { downloaded, skipped, failed, ...(incomplete ? { incomplete: true } : {}) };
    };

    const promise = run();
    _activeDownloadPromises.set(userId, promise);
    try {
      return await promise;
    } finally {
      _activeDownloadPromises.delete(userId);
    }
  },

  /**
   * S1-6: забор заметок по серверному `rev` — только изменения, без полных
   * списков. Документы читаются целиком (надгробия в выдаче), версии — только
   * идентичностью; содержимое приезжает существующими функциями по заметке.
   *
   * Курсор каждой таблицы двигается после того, как строки страницы применены,
   * и только до последней применённой. На первой неприменённой — стоп, курсор
   * = номер предыдущей; ошибка уходит вызывающему, который отличит отсутствие
   * колонки от настоящего сбоя.
   *
   * Забор ничего не удаляет и не отвязывает по отсутствию строки: действия —
   * только по явной строке-надгробию (TB-14) или живому изменению.
   */
  async pullNotesByRev(
    userId: string,
    opts?: { getActiveDocumentId?: () => string | null },
  ): Promise<PullNotesResult> {
    const empty = (): PullNotesResult => ({
      downloaded: 0, reconciled: 0, skipped: 0, corrupted: 0, failed: 0,
      documentsRev: 0, versionsRev: 0, deferred: 0,
    });
    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      return { ...empty(), locked: true };
    }

    const active = _activePullPromises.get(userId);
    if (active) return active;

    const run = async (): Promise<PullNotesResult> => {
      // Как в старом пути: без восстановления ссылок любая загрузка создаёт
      // вторую облачную/локальную копию. Отказ чтения здесь — исключение.
      await CloudSyncService.relinkOrphanedDocuments(userId);

      const localDocs = await LocalStorageService.getDocumentsByOwner(userId);
      // localOnly — «оставить только здесь»: старый проход не трогал такие
      // заметки ни при загрузке, ни при сверке; новый забор обязан так же.
      const linkedCloudMap = new Map(localDocs
        .filter(d => Boolean(d.linkedCloudId) && d.localOnly !== true)
        .map(d => [d.linkedCloudId!, d]));
      const localUuidSet = new Set(localDocs.map(d => d.uuid).filter((u): u is string => Boolean(u)));

      const start = await getSyncRevCursor(userId);
      let documentsRev = start.documents;
      let versionsRev = start.versions;
      let downloaded = 0;
      let reconciled = 0;
      let skipped = 0;
      let corrupted = 0;

      // uuid, чья строка уже обработана этим забором (документы или версии).
      const handled = new Set<string>();
      // Строки документов из page/documents и догрузки по uuid из versions.
      const docCache = new Map<string, Document>();
      const remember = (doc: Document): string => {
        const uuid = String(doc.uuid ?? doc.id ?? '');
        if (uuid) docCache.set(uuid, doc);
        return uuid;
      };

      const tombstoned = new Set<string>();
      const unreadable = new Set<string>();

      // S1-12: отложенные строки — в записи курсора; курсор их прошёл.
      const deferred = new Map((await getSyncRevDeferred(userId)).map(r => [r.uuid, r]));
      const defer = (uuid: string, rev: number, reason: string): void => {
        deferred.set(uuid, { uuid, rev, reason });
        handled.add(uuid);
      };
      const persistDeferred = () => setSyncRevDeferred(userId, Array.from(deferred.values()));

      const applyTombstone = async (uuid: string): Promise<void> => {
        tombstoned.add(uuid);
        const local = linkedCloudMap.get(uuid);
        if (local) {
          await requeueDocumentTask(local.id, userId);
          skipped++;
        }
        handled.add(uuid);
        deferred.delete(uuid);
      };

      const applyCloudDoc = async (cloudDoc: Document): Promise<void> => {
        const uuid = String(cloudDoc.uuid ?? cloudDoc.id ?? '');
        if (!uuid) throw new Error('PULL_ROW_WITHOUT_UUID');

        if (cloudDoc.deletedAt) {
          await applyTombstone(uuid);
          return;
        }

        const linkedLocal = linkedCloudMap.get(uuid);
        if (linkedLocal) {
          const res = await reconcileOneLinked(userId, linkedLocal, cloudDoc, opts);
          if (res.outcome === 'failed') throw new Error('PULL_APPLY_FAILED: ' + uuid);
          if (res.outcome === 'busy') throw new PullPaused(uuid);
          if (res.outcome === 'reconciled') reconciled++;
          else skipped++;
          corrupted += res.corrupted;
        } else if (localUuidSet.has(uuid)) {
          // Локальная копия есть, но не связана (localOnly/unlinkedByTombstone):
          // вторую не создаём — так же, как uuid-страж старого прохода.
          skipped++;
        } else {
          await downloadLimit(() => CloudSyncService.addLocalCopy(userId, uuid));
          downloaded++;
        }
        handled.add(uuid);
        deferred.delete(uuid);
      };

      /** Применить строку; стойкий отказ откладывает её вместо остановки. */
      const applyOrDefer = async (cloudDoc: Document, uuid: string, rev: number): Promise<void> => {
        try {
          await applyCloudDoc(cloudDoc);
        } catch (e) {
          const reason = deterministicPullFailure(e);
          if (reason === null) throw e;
          reportError(e, { action: 'pullNotes_deferred', userId, uuid, rev, reason }, 'warning');
          defer(uuid, rev, reason);
        }
      };

      let docSince = start.documents;
      try {
        // Повтор отложенных — до страниц: строка могла стать читаемой на месте,
        // без нового rev (починка на сервере), или получить надгробие.
        // R-5: внутри try, который ловит PullPaused — занятый замок на отложенной
        // строке раньше роняла весь забор ошибкой. Применённое пишется и при паузе.
        if (deferred.size > 0) {
          const records = await DataProvider.getDocumentsByUuidsWithDeleted(userId, Array.from(deferred.keys()));
          try {
            for (const record of records) {
              const u = String(record.uuid ?? record.id ?? '');
              const entry = deferred.get(u);
              if (!entry) continue;
              if (record.deletedAt) {
                await applyTombstone(u);
                continue;
              }
              const doc = await parseCloudDocument(record);
              if (!doc) continue; // по-прежнему не разбирается — остаётся отложенной
              await applyOrDefer(doc, u, entry.rev);
            }
          } finally {
            await persistDeferred();
          }
        }

        for (;;) {
          const page = await pullChangesSince(userId, 'documents', docSince, PULL_PAGE_SIZE);
          if (page.rows.length === 0) break;
          let lastApplied = docSince;
          try {
            // Разбор/расшифровка — параллельно, как в старом полном списке
            // (getUserDocuments): иначе первая синхронизация 300 заметок шла бы
            // по одной. Порядок ПРИМЕНЕНИЯ остаётся порядком rev.
            const prepared = await Promise.all(page.rows.map(async row => {
              const uuid = String(row.uuid ?? '');
              if (!uuid) return { kind: 'bad' as const, uuid };
              if (row.deleted_at !== null && row.deleted_at !== undefined) {
                return { kind: 'tombstone' as const, uuid };
              }
              const cloudDoc = await parseCloudDocument(fromDb(DOCUMENT_REV, row));
              // Строка документа идёт через тот же разбор/расшифровку, что и
              // полный список: сырые колонки в локальную копию не попадают.
              return cloudDoc
                ? { kind: 'doc' as const, uuid, doc: cloudDoc }
                : { kind: 'unreadable' as const, uuid };
            }));

            // Неизвестные заметки качаем заранее, с потолком downloadLimit, как
            // старый проход; результат разбирается по порядку rev, поэтому курсор
            // по-прежнему встаёт на первой неприменённой строке.
            const unknown = [...new Set(prepared
              .filter((p): p is { kind: 'doc'; uuid: string; doc: Document } => p.kind === 'doc')
              .map(p => p.uuid)
              .filter(uuid => !linkedCloudMap.has(uuid) && !localUuidSet.has(uuid)))];
            const downloadedOk = new Set<string>();
            const downloadFailed = new Map<string, unknown>();
            await Promise.all(unknown.map(async uuid => {
              try {
                await downloadLimit(() => CloudSyncService.addLocalCopy(userId, uuid));
                downloadedOk.add(uuid);
              } catch (e) {
                downloadFailed.set(uuid, e);
              }
            }));

            for (let i = 0; i < page.rows.length; i++) {
              const row = page.rows[i]!;
              const item = prepared[i]!;
              if (item.kind === 'bad') throw new Error('PULL_ROW_WITHOUT_UUID');
              if (item.kind === 'tombstone') {
                await applyTombstone(item.uuid);
              } else if (item.kind === 'unreadable') {
                // Не разобралась — не «строки нет»: откладываем с номером, курсор
                // идёт дальше, повтор каждым забором (S1-12).
                defer(item.uuid, row.rev, 'schema');
              } else {
                remember(item.doc);
                if (!linkedCloudMap.has(item.uuid) && !localUuidSet.has(item.uuid)) {
                  if (downloadFailed.has(item.uuid)) {
                    const err = downloadFailed.get(item.uuid);
                    const reason = deterministicPullFailure(err);
                    if (reason === null) throw err;
                    reportError(err, { action: 'pullNotes_deferred', userId, uuid: item.uuid, rev: row.rev, reason }, 'warning');
                    defer(item.uuid, row.rev, reason);
                  } else {
                    if (!downloadedOk.has(item.uuid)) throw new Error('PULL_DOWNLOAD_MISSING: ' + item.uuid);
                    downloaded++;
                    handled.add(item.uuid);
                    deferred.delete(item.uuid);
                  }
                } else {
                  await applyOrDefer(item.doc, item.uuid, row.rev);
                }
              }
              lastApplied = row.rev;
            }
          } catch (e) {
            // Отложенные пишутся ДО сдвига курсора: курсор за строкой без записи
            // о ней — потерянная заметка. Не записалось — курсор не двигаем.
            try {
              await persistDeferred();
              await advanceSyncRevCursor(userId, 'documents', lastApplied);
              documentsRev = lastApplied;
            } catch (persistErr) {
              reportError(persistErr, { action: 'pullNotes_persist_documents', userId });
            }
            throw e;
          }
          await persistDeferred();
          await advanceSyncRevCursor(userId, 'documents', lastApplied);
          documentsRev = lastApplied;
          docSince = lastApplied;
        }

        let verSince = start.versions;
        for (;;) {
          const page = await pullChangesSince(userId, 'versions', verSince, PULL_PAGE_SIZE);
          if (page.rows.length === 0) break;
          let lastApplied = verSince;
          try {
            // Строк заметок, которых не было в странице documents, дочитываем
            // пачками по 200 — вместе с надгробиями.
            const missing = [...new Set(page.rows
              .map(r => String(r.document_uuid ?? ''))
              .filter(u => u !== '' && !docCache.has(u) && !tombstoned.has(u) && !handled.has(u)))];
            if (missing.length > 0) {
              // Надгробия нужны как факт, а не как разобранная заметка: по ним
              // решается «отвязать», и схема тут ни при чём.
              const records = await DataProvider.getDocumentsByUuidsWithDeleted(userId, missing);
              const parsedRecords = await Promise.all(records.map(async record => {
                const u = String(record.uuid ?? record.id ?? '');
                if (!u) return { u, tombstone: false, doc: null as Document | null };
                if (record.deletedAt) return { u, tombstone: true, doc: null as Document | null };
                return { u, tombstone: false, doc: await parseCloudDocument(record) };
              }));
              for (const record of parsedRecords) {
                if (!record.u) continue;
                if (record.tombstone) {
                  tombstoned.add(record.u);
                } else if (record.doc) {
                  docCache.set(record.u, record.doc);
                } else {
                  // Не разобрали — не «строки нет»: курсор за неё не пойдёт,
                  // иначе заметка останется за курсором навсегда.
                  unreadable.add(record.u);
                }
              }
            }

            for (const row of page.rows) {
              const uuid = String(row.document_uuid ?? '');
              if (!uuid) throw new Error('PULL_VERSION_WITHOUT_DOCUMENT');
              if (!handled.has(uuid)) {
                if (unreadable.has(uuid)) {
                  defer(uuid, row.rev, 'schema');
                } else if (tombstoned.has(uuid)) {
                  await applyTombstone(uuid);
                } else {
                  const cloudDoc = docCache.get(uuid);
                  if (cloudDoc) await applyOrDefer(cloudDoc, uuid, row.rev);
                  else {
                    // Версия без строки заметки: применять не к чему, отсутствие
                    // строки ничего не значит и не удаляет.
                    handled.add(uuid);
                    skipped++;
                  }
                }
              }
              lastApplied = row.rev;
            }
          } catch (e) {
            try {
              await persistDeferred();
              await advanceSyncRevCursor(userId, 'versions', lastApplied);
              versionsRev = lastApplied;
            } catch (persistErr) {
              reportError(persistErr, { action: 'pullNotes_persist_versions', userId });
            }
            throw e;
          }
          await persistDeferred();
          await advanceSyncRevCursor(userId, 'versions', lastApplied);
          versionsRev = lastApplied;
          verSince = lastApplied;
        }
      } catch (e) {
        if (!(e instanceof PullPaused)) throw e;
        // Курсор уже стоит перед занятой строкой (catch страницы); остальное
        // этого прохода не читаем — порядок применения и есть порядок rev.
        skipped++;
        logger.info('pullNotesByRev', 'Pull paused: a note is locked by another writer', { uuid: e.uuid });
      }

      if (downloaded > 0 || reconciled > 0) {
        useActivityLogStore.getState().addActivity(
          'activity_cloud_downloaded_all',
          { action: 'pullNotes', downloaded, reconciled, skipped, corrupted },
          'info',
          'sync',
        );
      }

      return { downloaded, reconciled, skipped, corrupted, failed: 0, documentsRev, versionsRev, deferred: deferred.size };
    };

    const promise = run();
    _activePullPromises.set(userId, promise);
    try {
      return await promise;
    } finally {
      _activePullPromises.delete(userId);
    }
  },

  /**
   * SYNC-CURSOR-3: Policy B linked-note reconciliation.
   *
   * For each local document with linkedCloudId where the cloud copy is newer:
   * - No pending local edit (and note not open in active editor): silent fast-forward.
   * - Pending local edit exists (or note open in editor): keep on-screen content intact,
   *   fetch incoming cloud version and write as an additional entry in version history,
   *   and log exactly one activity log entry.
   */
  async reconcileLinkedDocuments(
    userId: string,
    opts?: { getActiveDocumentId?: () => string | null }
  ): Promise<ReconcileSummary> {
    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      return { reconciled: 0, skipped: 0, failed: 0, corrupted: 0, locked: true };
    }

    const active = _activeReconcilePromises.get(userId);
    if (active) return active;

    const run = async () => {
      try {
        const db = await getLocalDb(userId);
        // Результат здесь не нужен: список ожидающих заметок перечитывается под
        // локамом каждой заметки (A-2.3). Само чтение обязательно — бросок
        // означает "очередь не видна", и по невидимой очереди ничего не сверяем.
        await db.getAll('syncQueue');
      } catch (err) {
        reportError(err, { action: 'reconcileLinkedDocuments_syncQueue' });
        return { reconciled: 0, skipped: 0, failed: 1, corrupted: 0 };
      }

      const [localDocs, cloudList] = await Promise.all([
        LocalStorageService.getDocumentsByOwner(userId),
        readCloudDocumentsPartial(userId),
      ]);
      // R-2: сверяем по прочитанной части; неполнота уходит в результат, чтобы
      // курсор изменений не двигался (changeCursor).
      const cloudDocs = cloudList.docs;
      const incomplete = cloudList.unreadable.length > 0;
      if (incomplete) {
        reportError(new Error(`UNREADABLE_CLOUD_LIST: ${cloudList.unreadable.length} row(s)`), { action: 'reconcileLinkedDocuments_partialList', userId, unreadable: cloudList.unreadable.length }, 'warning');
      }

      const cloudDocMap = new Map(cloudDocs.map(cd => [cd.id, cd]));
      const linkedLocalDocs = localDocs.filter(d => Boolean(d.linkedCloudId) && d.localOnly !== true && cloudDocMap.has(d.linkedCloudId!));

      let reconciled = 0;
      let skipped = 0;
      let failed = 0;
      // A-4 (R2-004): сколько облачных версий не удалось прочитать при сверке.
      // Заметка при этом остаётся читаемой, поэтому это НЕ failed: курсор
      // изменений (changeCursor) на failed встаёт намертво.
      let corrupted = 0;

      for (const localDoc of linkedLocalDocs) {
        const cloudDoc = cloudDocMap.get(localDoc.linkedCloudId!)!;
        const res = await reconcileOneLinked(userId, localDoc, cloudDoc, opts);
        if (res.outcome === 'reconciled') reconciled++;
        else if (res.outcome === 'failed') failed++;
        else skipped++;
        corrupted += res.corrupted;
      }

      return { reconciled, skipped, failed, corrupted, ...(incomplete ? { incomplete: true } : {}) };
    };

    const promise = run();
    _activeReconcilePromises.set(userId, promise);
    try {
      return await promise;
    } finally {
      _activeReconcilePromises.delete(userId);
    }
  },

  /**
   * Restores links a lost/failed cloud read destroyed (a note read as
   * "Cloud Copy Lost" and unlinked). Must run before anything uploads or
   * downloads: an unlinked note is re-uploaded as a NEW cloud document and
   * re-downloaded as a SECOND local copy, so the cost of skipping it is
   * duplicates, not just a missing badge.
   *
   * Reads the cloud only when there is something to re-link, and throws rather
   * than returning 0 when that read fails — "could not ask" must never reach a
   * caller as "nothing matched".
   */
  async relinkOrphanedDocuments(userId: string): Promise<RelinkResult> {
    const localDocs = await LocalStorageService.getDocumentsByOwner(userId);
    if (!localDocs.some(hasRelinkWork)) return { relinked: 0, skippedIds: [] };
    let cloudDocs: Document[];
    let unreadableUuids: Set<string> | null = null;
    let unreadableStarts = new Set<number>();
    let blind = false;
    try {
      cloudDocs = await DocumentService.getUserDocuments(userId);
    } catch (e) {
      if (!(e instanceof UnreadableCloudListError)) throw e;
      // S1-10: прочитанная часть годится для перепривязки — совпадение uuid с
      // прочитанной строкой остаётся тождеством. Нечитаемая строка может быть
      // ровно той, к которой относится несвязанная заметка с тем же uuid: её
      // выгружать как новую нельзя (вторая копия). R-1: откладывается только
      // она — раньше откладывались все несвязанные, и один битый ряд держал на
      // устройстве каждую новую заметку, пока ряд не починят.
      reportError(e, { action: 'relinkOrphanedDocuments_partialList', userId, unreadable: e.ids.length }, 'warning');
      cloudDocs = e.docs;
      unreadableUuids = new Set(e.uuids);
      unreadableStarts = new Set(e.starts);
      blind = e.blind;
    }
    // R-6: по неполному списку — только по uuid: совпадение по времени с одной
    // прочитанной строкой ничего не доказывает, пока нечитаемая может быть второй.
    const res = await relinkOrphaned(localDocs, cloudDocs, { uuidOnly: unreadableUuids !== null });
    if (unreadableUuids === null) return res;
    const skipped = new Set(res.skippedIds);
    // relinkOrphaned правит localDocs на месте: кто связался — уже не кандидат.
    // C1: и по времени. Сверка по времени по неполному списку выключена (R-6), и
    // старая несвязанная заметка, чья пара — нечитаемый ряд с другим uuid или без
    // него, уходила бы в облако второй копией. Откладывается, если её время
    // совпало с нечитаемым рядом или с прочитанным (связать нельзя, грузить —
    // тоже). Нечитаемый ряд без uuid и времени — откладываются все: дубль хуже
    // задержки.
    const readableStarts = new Set(cloudDocs.map(c => toDate(c.firstSessionAt)?.getTime()).filter((t): t is number => t != null && !isNaN(t)));
    for (const d of localDocs) {
      if (!hasRelinkWork(d)) continue;
      const byUuid = !!d.uuid && unreadableUuids.has(d.uuid);
      const byTime = isRelinkCandidate(d) && (blind || unreadableStarts.has(d.firstSessionAt) || readableStarts.has(d.firstSessionAt));
      if (byUuid || byTime) skipped.add(d.id);
    }
    return { relinked: res.relinked, skippedIds: Array.from(skipped) };
  },

  async addLocalCopy(userId: string, cloudDocumentId: string): Promise<string> {
    return withDocumentLock(cloudDocumentId, async () => {
      const allLocal = await LocalStorageService.getDocumentsByOwner(userId);
      const existing = allLocal.find(d => d.linkedCloudId === cloudDocumentId);
      if (existing) return existing.id;

      const cloudDoc = await DocumentService.getDocument(userId, cloudDocumentId);
      if (!cloudDoc) throw new Error('Cloud document not found');
      if (cloudDoc._locked) throw new Error('LOCKED: cannot add local copy of locked document');
      if (cloudDoc._decryptionError) throw new Error('DECRYPTION_ERROR: cannot add local copy of unreadable document');

      // S-5: Check versions before creating a local document.
      // If the cloud document has 0 versions, do not create a zero-version local orphan.
      const versions = await VersionService.getVersions(userId, cloudDocumentId);
      if (!versions.length) {
        throw new Error('EMPTY_CLOUD_DOCUMENT: Cloud document has no versions');
      }

      const firstSessionMs = toDate(cloudDoc.firstSessionAt)?.getTime() ?? undefined;
      const lastSessionMs = toDate(cloudDoc.lastSessionAt)?.getTime() ?? undefined;

      let localId: string | undefined;

      try {
        localId = await LocalStorageService.createDocument(userId, {
          title: cloudDoc.title ?? '',
          tags: cloudDoc.tags ?? [],
          labelId: cloudDoc.labelId ?? undefined,
          firstSessionAt: firstSessionMs ?? undefined,
          lastSessionAt: lastSessionMs ?? undefined,
          mood: cloudDoc.mood,
          excludedFromAI: cloudDoc.excludedFromAI,
        });

        // S-1: Accept canonical uuid from the cloud doc inside the try block
        // so that a unique constraint collision cleans up the localId properly.
        // R3-5: заметка в корзине приезжает в корзину — раньше пометка терялась,
        // и на втором устройстве заметка становилась обычной (и снова шла в ИИ).
        const cloudTrashedAt = toDate((cloudDoc as { trashedAt?: unknown }).trashedAt)?.getTime();
        if (cloudDoc.uuid || cloudTrashedAt) {
          const db = await getLocalDb(userId);
          const tx = db.transaction('documents', 'readwrite');
          const localDoc = await tx.store.get(localId);
          if (localDoc) {
            await tx.store.put({
              ...localDoc,
              ...(cloudDoc.uuid ? { uuid: cloudDoc.uuid } : {}),
              ...(cloudTrashedAt ? { trashedAt: cloudTrashedAt } : {}),
            });
          }
          await tx.done;
        }

        let prevContent = '';
        // Versions whose ciphertext could not be turned back into text. The local
        // store holds PLAINTEXT, so a failed decrypt must never be written to it:
        // `ver.content` is Base64 ciphertext, and saving it made the note read as
        // gibberish that the app cannot tell from real writing — it would reach
        // search, export, backups and the AI context.
        const corruptedVersions: number[] = [];
        const latestVersionNo = versions.reduce((max, v) => Math.max(max, v.version ?? 1), 0);

        for (const ver of versions) {
          let startedAt = toDate(ver.sessionStartedAt) ?? toDate(ver.savedAt) ?? new Date();
          if (isNaN(startedAt.getTime())) startedAt = new Date();

          const verRecord: Record<string, unknown> = { ...ver };
          let verContent: string | null = null;
          let verMood: string | undefined = undefined;
          try {
            const decryptedVer = await maybeDecrypt(verRecord, ['content', 'mood'], []);
            // A non-string here means the payload is not what we think it is —
            // treated as corrupt rather than falling back to the raw field.
            verContent = typeof decryptedVer.content === 'string' ? decryptedVer.content : null;
            verMood = typeof decryptedVer.mood === 'string' ? decryptedVer.mood : (typeof ver.mood === 'string' ? ver.mood : undefined);
          } catch (decErr) {
            if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
            if (!(decErr instanceof DecryptionError)) throw decErr;
            verContent = null;
          }

          if (verContent === null) {
            corruptedVersions.push(ver.version ?? 1);
            continue;
          }

          await LocalVersionService.addVersion(userId, localId, {
            content: verContent,
            previousContent: prevContent,
            wordCount: ver.wordCount,
            duration: ver.duration,
            wpm: ver.wpm,
            versionNumber: ver.version ?? 1,
            goalWords: ver.goalWords,
            goalTime: ver.goalTime,
            goalReached: ver.goalReached,
            sessionStartedAt: startedAt,
            savedAt: ver.savedAt ? toDate(ver.savedAt) ?? undefined : undefined,
            mood: verMood,
          });
          prevContent = verContent;
        }

        // The newest version is what the note IS. If it could not be read, importing
        // the rest would show older text as if it were current — worse than not
        // having the note here at all, because nothing tells the user. The catch
        // below deletes the half-built local document and rethrows.
        if (corruptedVersions.includes(latestVersionNo)) {
          throw new Error(`DECRYPT_FAILED_LATEST: cloud document ${cloudDocumentId} version ${latestVersionNo}`);
        }

        if (corruptedVersions.length > 0) {
          reportError(
            new Error(`Skipped ${corruptedVersions.length} unreadable version(s) while importing a note`),
            { action: 'addLocalCopy_corruptedVersions', cloudDocumentId, versions: corruptedVersions.join(',') },
            'warning',
          );
          useActivityLogStore.getState().addActivity(
            'activity_cloud_corrupted_versions',
            { action: 'addLocalCopy_corruptedVersions', cloudDocumentId, count: corruptedVersions.length },
            'warning',
            'sync',
          );
        }

        // M-12: как в R4-005 — отставший счётчик облачного ряда прятал хвост
        // скачанной истории за «синхронизировано».
        const seenMaxVersion = Math.max(cloudDoc.currentVersion, latestVersionNo);
        // S0-4: метку даёт сервер. Строки без `updated_at` и без `created_at`
        // здесь быть не должно (`0001` даёт `default now()`, `0028/0043`
        // переставляют триггер), но если так — поле не трогаем: прежний fallback
        // `new Date()` ставил в ряд local time и прятал чужие изменения ровно на
        // величину хода часов.
        const cloudStampIso = cloudDoc.updatedAt
          ? new Date(cloudDoc.updatedAt).toISOString()
          : (cloudDoc.createdAt ? new Date(cloudDoc.createdAt).toISOString() : null);
        await LocalStorageService.updateDocument(localId, {
          totalWords: cloudDoc.totalWords,
          totalDuration: cloudDoc.totalDuration,
          currentVersion: seenMaxVersion,
          sessionsCount: cloudDoc.sessionsCount ?? 1,
          lastSyncedCloudVersion: seenMaxVersion,
          ...(cloudStampIso !== null ? { lastSeenCloudUpdatedAt: cloudStampIso } : {}),
        }, userId);

        await LocalStorageService.updateLinkedCloudId(localId, cloudDocumentId, userId);
        
        useActivityLogStore.getState().addActivity(
          'activity_cloud_note_downloaded',
          { action: 'addLocalCopy', documentId: localId, cloudDocumentId },
          'success',
          'sync'
        );

        return localId;
      } catch (e) {
        reportError(e, { action: 'addLocalCopy', cloudDocumentId });
        if (localId) {
          try { await LocalStorageService.deleteDocument(localId, userId); } catch (cleanupErr) { // намеренно: откат локальной копии при ошибке загрузки
            reportError(cleanupErr, { action: 'addLocalCopy_cleanup', localId });
          }
        }
        throw e;
      }
    // queueOnHeld: false — the lock key here is a CLOUD id. The default would
    // enqueue `sync_<cloudId>` as a document task, and the drain would then try
    // to addCloudCopy a local document that does not exist (ten failed attempts,
    // then quarantine). A second downloader simply fails with LOCK_HELD.
    }, { queueOnHeld: false, ownerId: userId });
  },

  async addCloudCopy(userId: string, localDocumentId: string): Promise<string> {
    if (!navigator.onLine) {
      throw new Error('Not connected to cloud. Changes saved locally.');
    }

    return withDocumentLock(
      localDocumentId,
      async () => {
        const localDoc = await LocalStorageService.getDocument(localDocumentId, userId);
      if (!localDoc) throw new Error('Local document not found');
      if (localDoc._locked || localDoc._decryptionError) {
        throw new Error('LOCKED: cannot add cloud copy of locked document');
      }
      if (localDoc.localOnly && !localDoc.unlinkedByTombstone) {
        await dropQueueTasksFor(localDocumentId, userId);
        // Кнопка, которая ничего не делает и молчит, читается как поломка.
        // Отказ здесь законный, но человек должен узнать причину.
        useActivityLogStore.getState().addActivity(
          'activity_cloud_local_only',
          { action: 'addCloudCopy_localOnly', documentId: localDocumentId },
          'warning',
          'sync',
        );
        return CLOUD_COPY_LOCAL_ONLY;
      }

      if (localDoc.linkedCloudId) {
        const getDoc = DocumentService.getDocumentWithDeleted?.bind(DocumentService) ?? DocumentService.getDocument.bind(DocumentService);
        const existingDoc = await withTimeout(getDoc(userId, localDoc.linkedCloudId));
        if (existingDoc) {
          if (existingDoc.deletedAt) {
            // AUDIT-H3: заметка удалена в облаке. Unlink с флагом localOnly:
            // иначе следующий syncAllUnlinked зальёт её как НОВЫЙ облачный
            // документ и удаление «воскреснет» под другим id.
            await LocalDocumentService.unlinkFromCloud(localDocumentId, 'tombstone', userId);
            await dropQueueTasksFor(localDocumentId, userId);
            useActivityLogStore.getState().addActivity(
              'activity_cloud_tombstone',
              { action: 'addCloudCopy_tombstone', documentId: localDocumentId },
              'warning',
              'sync',
            );
            return CLOUD_COPY_TOMBSTONE;
          }
          if (existingDoc._locked) throw new Error('LOCKED: cannot sync to locked cloud document');
          if (existingDoc._decryptionError) throw new Error('DECRYPTION_ERROR: cannot sync to unreadable cloud document');
          // Already linked: pull missing cloud versions down, push any LOCAL versions missing from the cloud
          const cloudId = localDoc.linkedCloudId;
          const [localVersions, cloudVersions] = await Promise.all([
            LocalVersionService.getVersions(localDocumentId, userId),
            withTimeout(VersionService.getVersions(userId, cloudId)),
          ]);
          const decryptedCloudVersions = await Promise.all(cloudVersions.map(async (cv) => {
            if (!cv._encrypted) return cv;
            try {
              const plain = await maybeDecrypt(cv as unknown as Record<string, unknown>, ['content', 'mood'], []);
              return {
                ...cv,
                content: typeof plain.content === 'string' ? plain.content : cv.content,
                mood: typeof plain.mood === 'string' ? plain.mood : cv.mood,
                _encrypted: false,
              };
            } catch (decErr) {
              if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
              if (!(decErr instanceof DecryptionError)) throw decErr;
              reportError(decErr, { action: 'addCloudCopy_decrypt', cloudId, version: cv.version });
              return { ...cv, _decryptionError: true };
            }
          }));
          const cloudVerMap = new Map(decryptedCloudVersions.map(v => [v.version, v]));
          const localVerMap = new Map(localVersions.map(v => [v.version, v]));
          const newestCloud = cloudVersions.reduce((max, v) => Math.max(max, v.version ?? 0), 0);
          const oldestCloud = cloudVersions.length > 0
            ? cloudVersions.reduce((min, v) => Math.min(min, v.version ?? 0), Infinity)
            : 0;

          // 1. Pull missing cloud versions down to local
          for (const cv of decryptedCloudVersions) {
            if (localVerMap.has(cv.version)) continue;
            if (cv._decryptionError) continue;

            await LocalVersionService.addVersion(userId, localDocumentId, {
              content: cv.content || '',
              previousContent: '',
              wordCount: cv.wordCount,
              duration: cv.duration,
              wpm: cv.wpm,
              versionNumber: cv.version,
              sessionStartedAt: cv.sessionStartedAt ?? new Date(),
              savedAt: cv.savedAt ?? undefined,
              mood: cv.mood,
            });
          }

          // 2. Identify local versions missing from cloud, or colliding with different content
          const missing: typeof localVersions = [];
          // AUDIT-MH5: коллизии собираем все, форк — ОДИН на документ.
          const collisions: typeof localVersions = [];
          let hasUnreadableVersion = false;
          for (const ver of localVersions) {
            const cloudVer = cloudVerMap.get(ver.version);
            if (!cloudVer) {
              // Older snapshots below oldestCloud were pruned by cloud housekeeping.
              // Any missing version within [oldestCloud, newestCloud] is a genuine gap.
              if (ver.version >= oldestCloud || cloudVersions.length === 0) {
                if (ver.version < newestCloud) {
                  reportError(
                    new Error(`Cloud version history gap detected: missing v${ver.version}`),
                    { action: 'addCloudCopy_versionGap', cloudId, missingVersion: ver.version, oldestCloud, newestCloud },
                    'warning',
                  );
                }
                missing.push(ver);
              }
            } else {
              // AG-CORRUPT-3: Refuse to declare divergence when unreadable (ciphertext vs plaintext, etc.)
              const comp = comparableOrUnknown(cloudVer, ver);
              if (!comp.comparable) {
                hasUnreadableVersion = true;
                continue;
              }
              if (!comp.same) {
                // Same version number, but DIFFERENT content! Fork to preserve local edits
                collisions.push(ver);
              }
            }
          }
          if (hasUnreadableVersion) {
            await requeueDocumentTask(localDocumentId, userId);
            useActivityLogStore.getState().addActivity(
              'activity_cloud_unreadable_version',
              { action: 'addCloudCopy_unreadableCloudVersion', documentId: localDocumentId, cloudId },
              'warning',
              'sync',
            );
            throw new Error('SYNC_UNRESOLVED: unreadable cloud version cannot be compared');
          }
          if (collisions.length > 0) {
            // N2-8: версии после первой коллизии построены на локальной ветке, а не
            // на облачной. В оригинал их не выгружаем — они уходят в форк вместе с
            // коллизией; иначе облачная история перемешивала две ветки.
            const firstCollision = Math.min(...collisions.map(v => v.version));
            for (let i = missing.length - 1; i >= 0; i--) {
              if (missing[i]!.version > firstCollision) missing.splice(i, 1);
            }
            const last = collisions[collisions.length - 1]!;
            await ConflictResolver.resolveConflict(
              userId,
              localDocumentId,
              cloudId,
              {
                title: localDoc.title,
                content: last.content,
                tags: localDoc.tags,
                wordCount: last.wordCount,
                duration: last.duration,
                wpm: last.wpm,
                sessionStartedAt: last.sessionStartedAt ? new Date(last.sessionStartedAt) : new Date(),
                labelId: localDoc.labelId,
                mood: last.mood,
              },
              last.version,
              existingDoc,
              localDoc.firstSessionAt ? new Date(localDoc.firstSessionAt).getTime() : undefined
            );
          }
          // N2-9: после форка оригинал приведён к облаку (счётчики, номер версии) —
          // метаданные ниже берём у него, а не у снимка до форка: иначе в облако
          // уходил currentVersion ветки, которая ушла в форк (cv4 при трёх
          // версиях), и следующая правка другого устройства не двигала облако
          // «вперёд» — её никто больше не видел.
          const metaDoc = collisions.length > 0
            ? (await LocalStorageService.getDocument(localDocumentId, userId)) ?? localDoc
            : localDoc;
          missing.sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
          // W-2: длительность, уехавшая в облако ЭТИМ прогоном. Именно она идёт
          // приращением в total_duration: этот же цикл — штатная дорога сессий,
          // сохранённых офлайн (дренаж очереди зовёт addCloudCopy), и с нулевой
          // дельтой такое время в облаке не появлялось никогда, а следующий pull
          // копировал облачный счётчик поверх локального и суммы человека
          // уменьшались. Версии, уже лежащие в облаке, в сумму не входят: их
          // приращение ушло той выгрузкой, которая их принесла.
          let uploadedDuration = 0;
          // W-6: долг прежних упавших вызовов и признак «счётчики уже в пути» —
          // снаружи try: catch решает по ним, что повиснет долгом.
          const owed = owedSessionDuration(userId, localDocumentId);
          let statsInFlight = false;
          // SF-7: метка, которую сервер отдал на НАШЕЙ записи счётчиков. От неё
          // зависит отметка «до какой облачной версии выгружен этот ряд».
          let writtenStamp: number | null = null;
          try {
          for (const ver of missing) {
            const idx = localVersions.findIndex(v => v.id === ver.id);
            const prevContent = idx <= 0 ? '' : (localVersions[idx - 1]?.content ?? '');
            const startedAt = ver.sessionStartedAt != null
              ? new Date(ver.sessionStartedAt)
              : new Date(ver.savedAt || Date.now());
            if (isNaN(startedAt.getTime())) {
              throw new Error(`Invalid sessionStartedAt for version ${ver.id}`);
            }
            const versionPayload = await maybeEncrypt({
              content: ver.content,
              previousContent: prevContent,
              wordCount: ver.wordCount,
              duration: ver.duration,
              wpm: ver.wpm,
              versionNumber: ver.version,
              goalWords: ver.goalWords,
              goalTime: ver.goalTime,
              goalReached: ver.goalReached,
              sessionStartedAt: startedAt,
              mood: ver.mood,
            } satisfies VersionEncryptPayload, ['content', 'previousContent', 'mood'], [], userId);
            const content = typeof versionPayload.content === 'string' ? versionPayload.content : '';
            const previousContent = typeof versionPayload.previousContent === 'string' ? versionPayload.previousContent : '';
            const mood = typeof versionPayload.mood === 'string' ? versionPayload.mood : ver.mood;
            const _encrypted = typeof versionPayload._encrypted === 'boolean' ? versionPayload._encrypted : undefined;
            await withTimeout(VersionService.addVersion(userId, cloudId, {
              content,
              previousContent,
              wordCount: ver.wordCount,
              wordsAdded: ver.wordsAdded,
              charsAdded: ver.charsAdded,
              duration: ver.duration,
              wpm: ver.wpm,
              versionNumber: ver.version,
              goalWords: ver.goalWords,
              goalTime: ver.goalTime,
              goalReached: ver.goalReached,
              sessionStartedAt: startedAt,
              savedAt: ver.savedAt ? new Date(ver.savedAt) : undefined,
              mood,
              _encrypted,
            }));
            uploadedDuration += ver.duration ?? 0;
          }
          // A run that ran out of write budget left versions behind. Advancing
          // currentVersion anyway told the cloud it holds text it never received,
          // and returning the id cleared the queue — so the gap became permanent
          // and the activity log said the note was saved. Report incomplete
          // instead: the link stays (the document exists, so a retry must not
          // create a second one) and the queue keeps the work.

          // Don't roll cloud metadata backward when the cloud copy is ahead of
          // this (behind) device — otherwise currentVersion regresses and a later
          // save can reuse a version number, overwriting a version via setDoc(`v${n}`).
          // R3-1: неудавшаяся правка метаданных — дослать целиком. Счётчики ниже их
          // не несут, а задачу из очереди дренаж снимает при любом cloudId.
          if (localDoc.metadataDirty) {
            await withTimeout(DocumentService.updateMetadata(userId, cloudId, {
              title: localDoc.title,
              tags: localDoc.tags ?? [],
              labelId: localDoc.labelId,
              excludedFromAI: localDoc.excludedFromAI,
              lastSessionAt: localDoc.lastSessionAt,
              trashedAt: localDoc.trashedAt ?? null,
            }));
            await LocalDocumentService.setMetadataDirty(localDocumentId, false, userId);
          } else if (missing.length > 0 && !localDoc.trashedAt && (existingDoc as { trashedAt?: unknown }).trashedAt) {
            // N2-2: заметку положили в корзину на другом устройстве, а здесь в неё
            // дописали. Свежий текст важнее корзины: возвращаем заметку, иначе
            // устройства расходятся — здесь она живая, там в корзине.
            await withTimeout(DocumentService.restoreDocument(userId, cloudId));
            useActivityLogStore.getState().addActivity(
              'activity_cloud_restored_from_trash',
              { action: 'addCloudCopy_restoredFromTrash', documentId: localDocumentId },
              'info',
              'sync',
            );
          }
          if (metaDoc.currentVersion >= existingDoc.currentVersion) {
            // W-6: к дельте этого прогона добавляем долг прежних упавших вызовов;
            // списываем его только после успеха — наросшее за время полёта остаётся.
            statsInFlight = true;
              writtenStamp = await withTimeout(DocumentService.updateDocumentAfterSession(userId, cloudId, {
                totalWords: metaDoc.totalWords,
                // V-5: приращение считает сервер (0039); W-2: дельта — длительность
                // версий, уехавших в облако этим прогоном. Нулевая дельта означала
                // бы, что сессии, сохранённые офлайн, в облачном total_duration не
                // появляются никогда.
                durationDelta: uploadedDuration + owed,
                currentVersion: metaDoc.currentVersion,
                // R7Q-003: приращение за этот прогон — ровно то число версий, которое
                // в облако уехало сейчас (одна версия = один ход). Абсолют из локальной
                // копии сюда не кладём: им устаревший писатель откатывал облачный
                // счётчик, а забор раздавал откат остальным устройствам.
                sessionsDelta: missing.length,
                lastSessionAt: metaDoc.lastSessionAt ? new Date(metaDoc.lastSessionAt) : undefined,
                mood: metaDoc.mood,
              }));
              settleSessionDuration(userId, localDocumentId, owed);
          }
          } catch (e) {
            settleOrOweAfterFailure(e, statsInFlight, userId, localDocumentId, owed, uploadedDuration);
            throw e;
          }
          const syncdVer = Math.max(metaDoc.currentVersion, existingDoc.currentVersion);
          await markCloudSeen(userId, localDocumentId, cloudId, syncdVer, 'linked', writtenStamp);
          return cloudId;
        }
        await LocalStorageService.updateLinkedCloudId(localDocumentId, '', userId);
      }

      const versions = await LocalVersionService.getVersions(localDocumentId, userId);

      let cloudId: string | null = null;
      // W-2: ряд, который облако держало и ДО этой выгрузки (столкнулись по uuid).
      // createDocument в него ничего не записал, поэтому счётчики обязана принести
      // дельта ниже — ровно как в linked-ветке.
      let adoptedCloudRow = false;

      const createPayload = {
        title: localDoc.title,
        tags: localDoc.tags,
        labelId: localDoc.labelId ?? undefined,
        uuid: localDoc.uuid,
        firstSessionAt: localDoc.firstSessionAt ? new Date(localDoc.firstSessionAt) : undefined,
        lastSessionAt: localDoc.lastSessionAt ? new Date(localDoc.lastSessionAt) : undefined,
        // Колонки в облаке есть, а сюда их не клали: «не показывать ИИ»
        // терялось при первой же выгрузке и не возвращалось никогда.
        mood: localDoc.mood,
        excludedFromAI: localDoc.excludedFromAI,
        trashedAt: localDoc.trashedAt ? new Date(localDoc.trashedAt) : undefined,
        currentVersion: localDoc.currentVersion ?? (versions.length > 0 ? versions.length : 1),
        totalWords: localDoc.totalWords,
        totalDuration: localDoc.totalDuration,
        sessionsCount: localDoc.sessionsCount,
      };

      try {
        cloudId = await withTimeout(DocumentService.createDocument(userId, createPayload));
      } catch (createErr: unknown) {
        const is23505 =
          (createErr !== null && typeof createErr === 'object' && 'code' in createErr && (createErr as { code: string }).code === '23505') ||
          (createErr instanceof Error && /23505|documents_uuid_key|duplicate key/i.test(createErr.message));

        const localDocUuid = localDoc.uuid;
        if (Boolean(is23505) && typeof localDocUuid === 'string' && localDocUuid.length > 0) {
          // Check for genuine duplicate: another local document claiming this UUID
          const allLocal = await LocalStorageService.getDocumentsByOwner(userId);
          const conflictingLocal = allLocal.find(d => d.id !== localDocumentId && (d.uuid === localDocUuid || d.linkedCloudId === localDocUuid));
          if (conflictingLocal) {
            throw new Error(`DUPLICATE_UUID_COLLISION: local document ${conflictingLocal.id} already claims uuid ${localDocUuid}`);
          }

          const existing = await DocumentService.findByUuid(userId, localDocUuid);
          if (existing) {
            cloudId = existing.uuid || existing.id;
            adoptedCloudRow = true;
            await LocalStorageService.updateLinkedCloudId(localDocumentId, cloudId, userId);
          } else {
            // LIFE-10: живой строки с этим номером нет, а ограничение
            // documents_uuid_key всё равно сработало — значит номер держит
            // НАДГРОБИЕ. Ровно этот тупик запер четырнадцать заметок в августе:
            // поиск отсеивает удалённые строки (`deleted_at is null`), а
            // ограничение — нет, и наружу выходила «duplicate key value
            // violates unique constraint».
            const buried = await withTimeout(DocumentService.getDocumentWithDeleted(userId, localDocUuid));
            if (!buried?.deletedAt) throw createErr;

            if (localDoc.unlinkedByTombstone !== true) {
              // Об удалении это устройство узнаёт впервые — возможно, её
              // сделали на другом. Обойти удаление, выгрузив заметку под новым
              // номером, значило бы отменить чужое решение молча. Записываем
              // удаление так же, как его записывает обычный проход, и говорим
              // человеку, что заметка осталась здесь.
              await LocalDocumentService.unlinkFromCloud(localDocumentId, 'tombstone', userId);
              await dropQueueTasksFor(localDocumentId, userId);
              useActivityLogStore.getState().addActivity(
                'activity_cloud_tombstone',
                { action: 'addCloudCopy_tombstonedUuid', documentId: localDocumentId, uuid: localDocUuid },
                'warning',
                'sync',
              );
              return CLOUD_COPY_TOMBSTONE;
            }

            // Повторное нажатие после того предупреждения — осознанный ответ
            // человека: сделать новую облачную копию. Старый номер остаётся за
            // могилой навсегда (RLS 0016 делает надгробие неизменяемым), поэтому
            // копия получает новый — и это смена личности заметки, о которой
            // надо сказать вслух, а не выполнить тихо.
            const freshUuid = crypto.randomUUID();
            await LocalDocumentService.updateDocumentUuid(localDocumentId, freshUuid, userId);
            cloudId = await withTimeout(DocumentService.createDocument(userId, {
              ...createPayload,
              uuid: freshUuid,
            }));
            await LocalStorageService.updateLinkedCloudId(localDocumentId, cloudId, userId);
            useActivityLogStore.getState().addActivity(
              'activity_cloud_new_identity',
              { action: 'addCloudCopy_newIdentity', documentId: localDocumentId, previousUuid: localDocUuid, uuid: freshUuid },
              'success',
              'sync',
            );
          }
        } else {
          throw createErr;
        }
      }

      // W-2/W-6: длительность, уехавшая в облако ЭТИМ прогоном, и долг прежних
      // упавших вызовов. Нужны вне try: catch обязан оставить висящим ровно то,
      // что в облако легло, но не было посчитано.
      // В ряд, созданный этим прогоном, createDocument уже положил локальную
      // сумму — долг внутри неё. Гасим его сразу: досланный дельтой (здесь или
      // позже, linked-веткой) он удвоил бы время.
      if (!adoptedCloudRow) {
        settleSessionDuration(userId, localDocumentId, owedSessionDuration(userId, localDocumentId));
      }
      let uploadedDuration = 0;
      // R7Q-003: сколько ходов принесла эта выгрузка (принятому ряду — не нуль).
      let uploadedSessions = 0;
      let owed = 0;
      let statsInFlight = false;
      // SF-7: метка, которую сервер отдал на записи счётчиков этого прогона.
      let createdStamp: number | null = null;
      try {
        const sortedVersions = [...versions].sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
        // W-2: при принятом ряде версия могла уехать в облако раньше (и тогда её
        // приращение уже лежит в total_duration), либо её перезаписал более свежий
        // ряд — засчитывать её второй раз нельзя.
        const alreadyInCloud = adoptedCloudRow
          ? new Set((await withTimeout(VersionService.getVersions(userId, cloudId!))).map(v => v.version))
          : null;
        owed = owedSessionDuration(userId, localDocumentId);
        for (let i = 0; i < sortedVersions.length; i++) {
          const ver = sortedVersions[i]!;
          const prevContent = i === 0 ? '' : (sortedVersions[i - 1]?.content ?? '');
          const startedAt = ver.sessionStartedAt != null
            ? new Date(ver.sessionStartedAt)
            : new Date(ver.savedAt || Date.now());
          if (isNaN(startedAt.getTime())) {
            throw new Error(`Invalid sessionStartedAt for version ${ver.id}`);
          }

          const versionPayload = await maybeEncrypt({
            content: ver.content,
            previousContent: prevContent,
            wordCount: ver.wordCount,
            duration: ver.duration,
            wpm: ver.wpm,
            versionNumber: ver.version,
            goalWords: ver.goalWords,
            goalTime: ver.goalTime,
            goalReached: ver.goalReached,
            sessionStartedAt: startedAt,
            mood: ver.mood,
          } satisfies VersionEncryptPayload, ['content', 'previousContent', 'mood'], [], userId);

          const content = typeof versionPayload.content === 'string' ? versionPayload.content : '';
          const previousContent = typeof versionPayload.previousContent === 'string' ? versionPayload.previousContent : '';
          const mood = typeof versionPayload.mood === 'string' ? versionPayload.mood : ver.mood;
          const _encrypted = typeof versionPayload._encrypted === 'boolean' ? versionPayload._encrypted : undefined;
          await withTimeout(VersionService.addVersion(userId, cloudId!, {
            content,
            previousContent,
            wordCount: ver.wordCount,
            wordsAdded: ver.wordsAdded,
            charsAdded: ver.charsAdded,
            duration: ver.duration,
            wpm: ver.wpm,
            versionNumber: ver.version,
            goalWords: ver.goalWords,
            goalTime: ver.goalTime,
            goalReached: ver.goalReached,
            sessionStartedAt: startedAt,
            savedAt: ver.savedAt ? new Date(ver.savedAt) : undefined,
            mood,
            _encrypted,
          }));
          if (alreadyInCloud && !alreadyInCloud.has(ver.version)) {
            uploadedDuration += ver.duration ?? 0;
            uploadedSessions++;
          }
        }

        statsInFlight = true;
        createdStamp = await withTimeout(DocumentService.updateDocumentAfterSession(userId, cloudId, {
          totalWords: localDoc.totalWords,
          // V-5: создавая облачный ряд, createDocument уже положил в него
          // накопленные счётчики этого устройства, поэтому за такую выгрузку
          // приращение нулевое — иначе первая синхронизация удвоила бы время.
          // W-2: принятому ряду (23505 по uuid) createDocument не писал ничего —
          // дельта равна длительности версий, которых в облаке до этого не было.
          // W-6: плюс долг прежних упавших вызовов, списывается только после успеха.
          durationDelta: uploadedDuration + owed,
          currentVersion: localDoc.currentVersion,
          // R7Q-003: свеже created ряду createDocument положил счётчики локальной
          // копии в саму строку — приращение нулевое, иначе первая синхронизация
          // удвоила бы ходы. Принятому ряду (23505 по uuid) считается столько,
          // сколько версий в облаке до этого не лежало.
          sessionsDelta: adoptedCloudRow ? uploadedSessions : 0,
          lastSessionAt: localDoc.lastSessionAt ? new Date(localDoc.lastSessionAt) : undefined,
          mood: localDoc.mood,
        }));
        settleSessionDuration(userId, localDocumentId, owed);
      } catch (e) {
        // W-6: принятому ряду версии уже легли в облако, а их время — нет.
        // В созданном этим прогоном ряду счётчики локальной копии уже внутри
        // строки (createPayload), там uploadedDuration и так нулевой.
        settleOrOweAfterFailure(e, statsInFlight, userId, localDocumentId, owed, uploadedDuration);
        // AUDIT-MH4: не откатываем частичную выгрузку. Облачный документ уже
        // создан, часть версий залита — удаление стирало бы успешную работу и,
        // если cleanup сам падал, оставляло orphan, который потом скачивался
        // как дубль-заметка. Ставим ссылку и бросаем дальше: retry по linked-
        // ветке докачает недостающие версии (pull/push missing там уже есть).
        if (cloudId) {
          reportError(e, { action: 'addCloudCopy_partial', cloudId }, 'warning');
          try { await LocalStorageService.updateLinkedCloudId(localDocumentId, cloudId, userId); }
          catch { /* существующий post-hoc dedup ниже разберётся */ }
        }
        throw e;
      }

      if (!cloudId) throw new Error('Failed to create cloud document');
      // A concurrent tab (whose lock may have appeared to expire during a long
      // upload) could have created+linked a cloud doc meanwhile. If so, discard
      // our duplicate and adopt the winner rather than orphaning a cloud document.
      const freshLocal = await LocalStorageService.getDocument(localDocumentId, userId);
      if (freshLocal?.linkedCloudId && freshLocal.linkedCloudId !== cloudId) {
        try { await DocumentService.deleteDocument(userId, cloudId); }
        catch (cleanupErr) { reportError(cleanupErr, { action: 'addCloudCopy_dupCleanup', cloudId }); }
        return freshLocal.linkedCloudId;
      }
      // The link is set even when the upload is incomplete: the cloud document
      // exists, and a retry that did not know about it would create a second one.
      await LocalStorageService.updateLinkedCloudId(localDocumentId, cloudId, userId);
      await LocalStorageService.migrateDocumentOwner(localDocumentId, userId, userId);
      await markCloudSeen(userId, localDocumentId, cloudId, null, 'created', createdStamp);

      useActivityLogStore.getState().addActivity(
        'activity_cloud_note_saved',
        { action: 'addCloudCopy', documentId: localDocumentId, cloudDocumentId: cloudId },
        'success',
        'sync'
      );
      
      return cloudId;
      },
      {
        ownerId: userId,
        onLockHeld: () => '',
      },
    );
  },

  async removeCloudCopy(userId: string, cloudDocumentId: string, localDocumentId?: string): Promise<void> {
    // Сводку и вектор удаляет сам deleteDocument (providers/documents.ts), с
    // проверкой ошибки на каждом шаге и до надгробия. Повторное удаление здесь
    // шло с непрочитанным результатом и ничего не добавляло (N-53).
    await DocumentService.deleteDocument(userId, cloudDocumentId);
    if (localDocumentId) {
      await LocalStorageService.updateLinkedCloudId(localDocumentId, '', userId);
    }
  },

  async getDocument(userId: string, cloudId: string) {
    return DocumentService.getDocument(userId, cloudId);
  },

  async syncVersionToCloud(
    userId: string,
    documentId: string,
    linkedCloudId: string,
    data: SaveDocumentData,
    newVersion: number,
    prevContent: string
  ): Promise<{ forked: boolean; forkTitle?: string | undefined; cloudSynced: boolean; reason?: string }> {
    if (!navigator.onLine) {
      await requeueDocumentTask(documentId, userId);
      return { forked: false, cloudSynced: false };
    }

    return withDocumentLock(
      documentId,
      async () => {
        try {
      const getDoc = DocumentService.getDocumentWithDeleted?.bind(DocumentService) ?? DocumentService.getDocument.bind(DocumentService);
      const cloudDoc = await getDoc(userId, linkedCloudId);
      if (cloudDoc?._locked) {
        throw new Error('LOCKED: cannot sync version to locked cloud document');
      }
      if (cloudDoc?._decryptionError) {
        throw new Error('DECRYPTION_ERROR: cannot sync version to unreadable cloud document');
      }
      if (cloudDoc?.deletedAt) {
        // Document was soft-deleted in the cloud (tombstone). Clean up local link and syncQueue.
        await LocalStorageService.unlinkFromCloud(documentId, 'tombstone', userId);
        await dropQueueTasksFor(documentId, userId);
        return { forked: false, cloudSynced: false };
      }
      if (!cloudDoc) {
        await requeueDocumentTask(documentId, userId);
        return { forked: false, cloudSynced: false };
      }

      // Reconcile cloud versions before pushing (pull-before-push)
      const cloudVersions = await VersionService.getVersions(userId, linkedCloudId);
      const decryptedCloudVersions = await Promise.all(cloudVersions.map(async (cv) => {
        if (!cv._encrypted) return cv;
        try {
          const plain = await maybeDecrypt(cv as unknown as Record<string, unknown>, ['content', 'mood'], []);
          return {
            ...cv,
            content: typeof plain.content === 'string' ? plain.content : cv.content,
            mood: typeof plain.mood === 'string' ? plain.mood : cv.mood,
            _encrypted: false,
          };
        } catch (decErr) {
          if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
          if (!(decErr instanceof DecryptionError)) throw decErr;
          reportError(decErr, { action: 'syncVersionToCloud_decrypt', cloudId: linkedCloudId, version: cv.version });
          return { ...cv, _decryptionError: true };
        }
      }));
      const localVersions = await LocalVersionService.getVersions(documentId, userId);
      const cloudVerMap = new Map(decryptedCloudVersions.map(v => [v.version, v]));
      const localVerNums = new Set(localVersions.map(v => v.version));

      // Pull missing cloud versions down to local
      for (const cv of decryptedCloudVersions) {
        if (localVerNums.has(cv.version)) continue;
        if (cv._decryptionError) continue;

        await LocalVersionService.addVersion(userId, documentId, {
          content: cv.content || '',
          previousContent: '',
          wordCount: cv.wordCount,
          duration: cv.duration,
          wpm: cv.wpm,
          versionNumber: cv.version,
          sessionStartedAt: cv.sessionStartedAt ?? new Date(),
          savedAt: cv.savedAt ?? undefined,
          mood: cv.mood,
        });
      }

      const newestCloudVersion = cloudVersions.reduce((max, v) => Math.max(max, v.version ?? 0), 0);
      const maxCloudVersion = Math.max(cloudDoc.currentVersion, newestCloudVersion);

      if (maxCloudVersion >= newVersion) {
        const localDoc = await LocalStorageService.getDocument(documentId, userId);
        const cloudHead = cloudVerMap.get(maxCloudVersion);
        const cloudHeadContent = cloudHead?.content;

        if (cloudHead) {
          // AG-CORRUPT-3: Shared predicate. An unreadable side is unknown, not different. Leave queued for retry.
          const comp = comparableOrUnknown(cloudHead, { content: data.content });
          if (!comp.comparable) {
            await requeueDocumentTask(documentId, userId);
            useActivityLogStore.getState().addActivity(
              'activity_cloud_unreadable_version',
              { action: 'syncVersionToCloud_unreadableCloudHead', documentId, version: maxCloudVersion },
              'warning',
              'sync',
            );
            return { forked: false, cloudSynced: false, reason: 'unknown' };
          }

          // 1. Idempotent write: cloud already holds this exact content at head
          if (comp.same) {
            newVersion = maxCloudVersion;
          }
          // 2. Genuine fast-forward: local edit was built directly on top of cloud head
          else if (cloudHeadContent !== undefined && prevContent === cloudHeadContent) {
            // Local started from the cloud head, but local version counter was behind:
            // advance cleanly to maxCloudVersion + 1 with NO fork
            newVersion = maxCloudVersion + 1;
          }
          // 3. Genuine divergence: cloud moved to maxCloudVersion with different content,
          // and local created divergent content from an older base
          else {
            const result = await ConflictResolver.resolveConflict(
              userId,
              documentId,
              linkedCloudId,
              data,
              newVersion,
              cloudDoc,
              localDoc?.firstSessionAt
            );
            return { ...result, cloudSynced: false };
          }
        } else {
          // AG-SYNC-11: No cloud row for maxCloudVersion. The write is not treated as idempotent.
          // Fall back to conflict resolution (divergence).
          const result = await ConflictResolver.resolveConflict(
            userId,
            documentId,
            linkedCloudId,
            data,
            newVersion,
            cloudDoc,
            localDoc?.firstSessionAt
          );
          return { ...result, cloudSynced: false };
        }
      }

      const startedAt = data.sessionStartedAt;
      if (isNaN(startedAt.getTime())) {
        throw new Error('Invalid sessionStartedAt');
      }
      const localDiff = computeWordDelta(prevContent, data.content);
      const versionPayload = await maybeEncrypt({
        content: data.content,
        previousContent: prevContent,
        wordCount: data.wordCount,
        duration: data.duration,
        wpm: data.wpm,
        versionNumber: newVersion,
        goalWords: data.goalWords,
        goalTime: data.goalTime,
        goalReached: data.goalReached,
        sessionStartedAt: startedAt,
        mood: data.mood,
      } satisfies VersionEncryptPayload, ['content', 'previousContent', 'mood'], [], userId);
      const content = typeof versionPayload.content === 'string' ? versionPayload.content : '';
      const previousContent = typeof versionPayload.previousContent === 'string' ? versionPayload.previousContent : '';
      const mood = typeof versionPayload.mood === 'string' ? versionPayload.mood : data.mood;
      const _encrypted = typeof versionPayload._encrypted === 'boolean' ? versionPayload._encrypted : undefined;

      try {
        await VersionService.addVersion(userId, linkedCloudId, {
          content,
          previousContent,
          wordCount: data.wordCount,
          wordsAdded: localDiff.wordsAdded,
          charsAdded: localDiff.charsAdded,
          duration: data.duration,
          wpm: data.wpm,
          versionNumber: newVersion,
          goalWords: data.goalWords,
          goalTime: data.goalTime,
          goalReached: data.goalReached,
          sessionStartedAt: startedAt,
          mood,
          _encrypted,
        });
      } catch (addVerErr) {
        // Repair path for split metadata: recompute from max(version) and retry
        const freshVersions = await VersionService.getVersions(userId, linkedCloudId);
        const actualMax = freshVersions.reduce((max, v) => Math.max(max, v.version ?? 0), 0);
        if (actualMax >= newVersion) {
          newVersion = actualMax + 1;
          await VersionService.addVersion(userId, linkedCloudId, {
            content,
            previousContent,
            wordCount: data.wordCount,
            wordsAdded: localDiff.wordsAdded,
            charsAdded: localDiff.charsAdded,
            duration: data.duration,
            wpm: data.wpm,
            versionNumber: newVersion,
            goalWords: data.goalWords,
            goalTime: data.goalTime,
            goalReached: data.goalReached,
            sessionStartedAt: startedAt,
            // B-1: тот же зашифрованный mood, что и в первой попытке.
            mood,
            _encrypted,
          });
        } else {
          throw addVerErr;
        }
      }


      try {
        await DocumentService.updateDocumentAfterSession(userId, linkedCloudId, {
          totalWords: data.documentWordCount ?? data.wordCount,
          // V-5: дельта — длительность ИМЕННО этой сессии (documentDuration —
          // абсолют, он уже лежит в локальной копии и в созданном облачном ряде).
          durationDelta: data.duration,
          currentVersion: newVersion,
          mood: data.mood,
        });
      } catch (e) {
        // W-6: ряд версии в облаке уже лежит, а её секунды — нет. Задача встанет
        // в очередь, дренаж увидит ряд отправленным и принёс бы дельту 0.
        oweSessionDuration(userId, documentId, data.duration);
        throw e;
      }

      // N2-2 (тот же случай на пути сохранения): в заметку, которую другое
      // устройство положило в корзину, здесь только что дописали — возвращаем.
      if ((cloudDoc as { trashedAt?: unknown }).trashedAt) {
        const here = await LocalStorageService.getDocument(documentId, userId);
        if (!here?.trashedAt) {
          await DocumentService.restoreDocument(userId, linkedCloudId);
          useActivityLogStore.getState().addActivity(
            'activity_cloud_restored_from_trash',
            { action: 'syncVersionToCloud_restoredFromTrash', documentId },
            'info',
            'sync',
          );
        }
      }

      // AUDIT-MH1: успешный push фиксирует base для следующего конфликта-чекa.
      try {
        const db = await getLocalDb(userId);
        const tx = db.transaction('documents', 'readwrite');
        const fresh = await tx.store.get(documentId);
        if (fresh) {
          await tx.store.put({ ...fresh, lastSyncedCloudVersion: newVersion });
        }
        await tx.done;
      } catch { /* некритично: без поля сработает legacy-сравнение контента */ }

      useActivityLogStore.getState().addActivity(
        'activity_cloud_changes_saved',
        { action: 'syncVersionToCloud', documentId, newVersion },
        'success',
        'sync'
      );
      return { forked: false, cloudSynced: true };
    } catch (e) {
      reportError(e, { action: 'syncVersionToCloud', documentId, linkedCloudId });
      if (!isPoisonSyncError(e)) {
        try {
          await requeueDocumentTask(documentId, userId);
        } catch (queueErr) {
          reportError(queueErr, { action: 'syncVersionToCloud_queueSync', documentId });
        }
      } else {
        try {
          await quarantineDocumentTask(documentId, userId, e);
        } catch (queueErr) {
          reportError(queueErr, { action: 'syncVersionToCloud_quarantineTask', documentId });
        }
      }
      return { forked: false, cloudSynced: false };
    }
  },
  {
    ownerId: userId,
    onLockHeld: () => ({ forked: false, cloudSynced: false, reason: 'LOCK_HELD' }),
  },
);
  },

  /** Pushes the locally-cached AI profile portrait to Supabase. Lives here
   *  (not in features/ai) so the sync-queue drain (core/services/SyncService,
   *  which must not import from features/) can call it directly for queued
   *  'portrait' tasks. AIProfileService.syncPortraitToCloud delegates here. */
  async syncPortraitToCloud(userId: string): Promise<void> {
    // Источник — IndexedDB, а не кэш в localStorage. Кэш привязан к аккаунту и
    // может быть пуст в момент, когда очередь синхронизации доходит до задачи:
    // именно поэтому колонка users.ai_portrait стояла пустой при живом
    // портрете на устройстве.
    const db = await getLocalDb(userId);
    const stored = await db.get('aiPortrait', 'singleton');
    const portraitMarkdown = stored?.portrait;
    if (!portraitMarkdown) return;

    const encrypted = await maybeEncrypt(
      { aiPortrait: portraitMarkdown },
      ['aiPortrait'],
      [],
      userId,
    );
    await DataProvider.updateProfile(userId, encrypted);
  },
};

// AUDIT-part2 5.1: интерпретация флагов через единый syncStatusOf.
function isRelinkCandidate(doc: LocalDocument): boolean {
  return syncStatusOf(doc) === 'unlinked-new' && !!doc.firstSessionAt;
}

/**
 * Есть ли для заметки работа у перепривязки — вопрос, который задаётся ДО
 * чтения облака и решает, читать ли его вообще.
 *
 * Отдельно от isRelinkCandidate, потому что тот описывает только сверку по
 * времени. Сверка по постоянному номеру работает и с заметками, помеченными
 * «только на устройстве», — и без этой функции она стояла за воротами,
 * пропускавшими ровно тех, для кого была написана: проход возвращал 0, не
 * дойдя до неё.
 */
function hasRelinkWork(doc: LocalDocument): boolean {
  const status = syncStatusOf(doc);
  if (status === 'unlinked-new') return !!doc.firstSessionAt || !!doc.uuid;
  if (status === 'local-only') return !!doc.uuid;
  return false;
}

/**
 * Pairs unlinked local notes back to their cloud copies on `firstSessionAt` —
 * the one field both copy directions carry over verbatim (addCloudCopy and
 * addLocalCopy each pass it straight into createDocument) and that only an
 * explicit date edit changes, which writes both sides together.
 *
 * Only unambiguous 1:1 matches are linked: two notes sharing a start timestamp
 * are left for the owner rather than guessed at. Mutates `localDocs` in place
 * so a caller that already holds the array sees the new links.
 */
async function relinkOrphaned(
  localDocs: LocalDocument[],
  cloudDocs: Document[],
  opts: { uuidOnly?: boolean } = {},
): Promise<RelinkResult> {
  const takenCloudIds = new Set(localDocs.map(d => d.linkedCloudId).filter(Boolean));
  let relinkedByUuid = 0;
  const skippedIds = new Set<string>();

  // Проход первый — по ПОСТОЯННОМУ номеру заметки. Это не догадка: совпадение
  // uuid означает, что облачная строка и есть эта заметка. Сверка по времени
  // ниже появилась раньше uuid и осталась запасной.
  //
  // Сюда попадают и заметки, помеченные «только на устройстве». Это безопасно
  // по построению: удалённые в облаке строки сюда не приходят вовсе —
  // getUserDocuments отдаёт только живые, — значит совпадение возможно лишь с
  // существующей копией, а не с воскрешаемой. Без этого заметка, чья облачная
  // строка когда-то потерялась, не может вернуться в облако никогда: под своим
  // номером она не вставится (uuid уникален), а под чужим её быть не должно.
  const cloudByUuid = new Map<string, Document>();
  for (const cloudDoc of cloudDocs) {
    const uuid = (cloudDoc as { uuid?: string }).uuid;
    if (!uuid || takenCloudIds.has(cloudDoc.id)) continue;
    if (cloudByUuid.has(uuid)) { cloudByUuid.delete(uuid); continue; }  // неоднозначно — не трогаем
    cloudByUuid.set(uuid, cloudDoc);
  }
  for (const local of localDocs) {
    const status = syncStatusOf(local);
    if (status !== 'unlinked-new' && status !== 'local-only') continue;
    if (!local.uuid) continue;
    const match = cloudByUuid.get(local.uuid);
    if (!match) continue;

    // FU-3: protect against race with concurrent editor saves or other sync drains
    await withDocumentLock(
      local.id,
      async () => {
        await LocalStorageService.updateLinkedCloudId(local.id, match.id, local.guestId);
        local.linkedCloudId = match.id;
        delete local.localOnly;
        takenCloudIds.add(match.id);
        cloudByUuid.delete(local.uuid!);
        relinkedByUuid++;

        // Связь вернулась — но содержимое в облаке от этого не появилось: строка
        // могла остаться пустой, как и было у осиротевших. Ставим задачу в
        // очередь, иначе заметка числится связанной и не выгружается никогда.
        try {
          await requeueDocumentTask(local.id, local.guestId);
        } catch (queueErr) {
          reportError(queueErr, { action: 'relinkByUuid_queueSync', documentId: local.id });
        }
      },
      {
        // Замок — в базе владельца заметки, а не того, кто вошёл сейчас.
        ownerId: local.guestId,
        queueOnHeld: false,
        onLockHeld: () => {
          // L-2: Document currently locked by active writer or sync drain.
          // Record skipped id so syncAllUnlinked does not upload a duplicate cloud note.
          skippedIds.add(local.id);
        },
      },
    );
  }

  const candidates = opts.uuidOnly ? [] : localDocs.filter(d => isRelinkCandidate(d) && !skippedIds.has(d.id));
  if (candidates.length === 0) return { relinked: relinkedByUuid, skippedIds: Array.from(skippedIds) };
  const localsByStart = new Map<number, LocalDocument[]>();
  for (const doc of candidates) {
    const group = localsByStart.get(doc.firstSessionAt);
    if (group) group.push(doc); else localsByStart.set(doc.firstSessionAt, [doc]);
  }

  const cloudByStart = new Map<number, Document[]>();
  for (const cloudDoc of cloudDocs) {
    if (takenCloudIds.has(cloudDoc.id)) continue;
    const start = toDate(cloudDoc.firstSessionAt)?.getTime();
    if (start == null || isNaN(start) || !localsByStart.has(start)) continue;
    const group = cloudByStart.get(start);
    if (group) group.push(cloudDoc); else cloudByStart.set(start, [cloudDoc]);
  }

  // AUDIT-L11: firstSessionAt (мс-таймстемп) — хрупкий единственный сигнал
  // идентичности. Второй сигнал — нормализованный заголовок.
  //
  // Сигнал СОВЕЩАТЕЛЬНЫЙ, а не обязательный. Заголовки облачных заметок
  // расшифровываются при чтении: при закрытом сейфе (фоновый синк ходит и
  // так) сравнивать нечего, а отказ от перелинковки означает не «оставим на
  // ручной разбор», а вторую копию в облаке — ровно тот баг, ради которого
  // перелинковка и появилась. Переименование на одном устройстве даёт то же
  // самое. Поэтому расходящимися считаем только два читаемых непустых
  // заголовка; во всех прочих случаях решает совпадение времени, как раньше.
  const norm = (t: string | undefined): string => (t ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const titlesContradict = (local: LocalDocument, cloud: Document): boolean => {
    if (cloud._locked || cloud._decryptionError) return false;
    const a = norm(local.title);
    const b = norm(cloud.title);
    if (a.length === 0 || b.length === 0) return false;
    return a.slice(0, 32) !== b.slice(0, 32);
  };

  let relinked = relinkedByUuid;
  for (const [start, locals] of localsByStart) {
    const cloudMatches = cloudByStart.get(start);
    const local = locals[0];
    const cloudDoc = cloudMatches?.[0];
    if (locals.length !== 1 || cloudMatches?.length !== 1 || !local || !cloudDoc) continue;
    if (titlesContradict(local, cloudDoc)) continue;

    // FU-3: protect against race with concurrent editor saves or other sync drains
    await withDocumentLock(
      local.id,
      async () => {
        await LocalStorageService.updateLinkedCloudId(local.id, cloudDoc.id, local.guestId);
        local.linkedCloudId = cloudDoc.id;
        relinked++;
      },
      {
        // Замок — в базе владельца заметки, а не того, кто вошёл сейчас.
        ownerId: local.guestId,
        queueOnHeld: false,
        onLockHeld: () => {
          // L-2: Document locked; record skipped id to avoid duplicate upload
          skippedIds.add(local.id);
        },
      },
    );
  }

  if (relinked > 0) {
    useActivityLogStore.getState().addActivity(
      'activity_cloud_relinked',
      { action: 'relinkOrphanedDocuments', count: relinked },
      'success',
      'sync'
    );
  }
  return { relinked, skippedIds: Array.from(skippedIds) };
}

export const __testing = { relinkOrphaned };
