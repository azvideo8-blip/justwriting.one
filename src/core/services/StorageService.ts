import { withDocumentLock, LOCK_TTL_MS } from '../sync/withDocumentLock';
import { getLocalDb, type LocalDocument, type MetadataField } from '../storage/localDb';
import { emitDomainEvent } from '../events/domainEvents';
import { LocalStorageService } from './LocalStorageService';
import { LocalDocumentService } from './LocalDocumentService';
import { DocumentService, UnreadableCloudRowError } from './DocumentService';
import { CloudSyncService } from './CloudSyncService';
import { ProfileUpdater } from './ProfileUpdater';
import { SaveDocumentData, StorageState } from './storageTypes';
import { withTimeout } from '../../shared/utils/withTimeout';
import { reportError } from '../../shared/errors/reportError';
import { watchLocalDbStall } from '../storage/localDbStall';
import { getEncryptionEnabled } from '../crypto/cryptoHelpers';
import { isVersionContentTooLarge } from './VersionService';
import { cloudSyncEnabled } from '../sync/cloudSyncEnabled';
import { addToSyncQueue } from './syncQueueOps';

export type { StorageState, SaveDocumentData } from './storageTypes';

class LockManager {
  private locks = new Map<string, Promise<void>>();

  async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) || Promise.resolve();
    let result: T | undefined;
    const next = prev.then(
      async () => { result = await fn(); },
      async (prevErr) => { throw prevErr; },
    );
    const stored = next.then(() => {}, () => {});
    this.locks.set(key, stored);
    try {
      await next;
    } finally {
      if (this.locks.get(key) === stored) this.locks.delete(key);
    }
    return result!;
  }
}

const _lockManager = new LockManager();

// Облачный номер заметки — из её локальной записи. Не прочиталась — где
// облачная копия, неизвестно: failed = true, и облако «сделанным» не объявляется.
async function resolveCloudId(userId: string, localId?: string, cloudId?: string): Promise<{ cloudId?: string | undefined; failed: boolean }> {
  if (!localId || cloudId) return { cloudId, failed: false };
  try {
    const fresh = await LocalStorageService.getDocument(localId, userId);
    return { cloudId: fresh?.linkedCloudId || undefined, failed: false };
  } catch (e) {
    reportError(e, { action: 'resolveCloudId', documentId: localId });
    return { cloudId: undefined, failed: true };
  }
}

// N2-1: задача 'document' без флага досылала только версии — корзина,
// изменённая без связи, до облака не доходила никогда.
async function queueMetadataRetry(userId: string, localId: string): Promise<void> {
  // S2-6: здесь это только корзина (в неё и из неё) — досылается одно поле.
  await LocalDocumentService.setMetadataDirty(localId, true, userId, 'trashedAt');
  const db = await getLocalDb(userId);
  await db.put('syncQueue', {
    id: `doc_${localId}_${Date.now()}`,
    documentId: localId,
    type: 'document' as const,
    createdAt: Date.now(),
    ownerId: userId,
  });
}

// Метка «снести облачный ряд» — одна на заметку и идемпотентная: её ставит и
// транзакция удаления локальной строки (SB-2), и этот хелпер, когда локальной
// строки нет вовсе (удаление только по облачному номеру).
async function queueCloudRemoval(userId: string, cloudId: string): Promise<void> {
  const db = await getLocalDb(userId);
  const existing = (await db.getAll('syncQueue')).find(t => t.type === 'delete' && t.documentId === cloudId);
  if (existing && !existing.dead && existing.revocable) return;
  // Повторное удаление оживляет задачу из карантина: мёртвая не дренируется, и
  // «из облака удалится позже» было бы неправдой (дейлик 25.11).
  // updatedAt — чтобы идущий проход, решивший снять прежнюю задачу, не снял новую (SB-1).
  await db.put('syncQueue', existing ? { ...existing, dead: false, attempts: 0, revocable: true, updatedAt: Date.now() } : {
    id: `delete_${cloudId}_${Date.now()}`,
    documentId: cloudId,
    type: 'delete' as const,
    createdAt: Date.now(),
    ownerId: userId,
    revocable: true,
  });
}

async function hasRemovalTask(userId: string, cloudId: string): Promise<boolean> {
  return (await (await getLocalDb(userId)).getAll('syncQueue')).some(t => t.type === 'delete' && t.documentId === cloudId);
}

// Подтверждённое удаление: очередь больше не должна помнить про ряд, иначе
// счётчик «ожидающих удалений» в badge вечно показывает то, что уже сделано.
async function clearCloudRemovalTasks(userId: string, cloudId: string): Promise<void> {
  const db = await getLocalDb(userId);
  const stale = (await db.getAll('syncQueue')).filter(t => t.type === 'delete' && t.documentId === cloudId);
  if (stale.length === 0) return;
  const tx = db.transaction('syncQueue', 'readwrite');
  for (const task of stale) await tx.store.delete(task.id);
  await tx.done;
}

// Дождаться, пока удаление этой строки (другая вкладка, дренаж) закончится.
async function withCloudRowLock(userId: string, cloudId: string, fn: () => Promise<void>): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    const done = await withDocumentLock(cloudId, async () => { await fn(); return true; },
      { queueOnHeld: false, onLockHeld: () => false, ownerId: userId });
    if (done) return;
    if (Date.now() - startedAt >= LOCK_TTL_MS * 2) throw new Error(`LOCK_HELD: cloud document ${cloudId} is busy`);
    await new Promise(r => setTimeout(r, 500));
  }
}

async function deleteDocumentUnlocked(userId: string, localId?: string, cloudId?: string): Promise<{ cloudSynced: boolean; derivativesOk: boolean; applied: boolean }> {
  const { cloudId: targetCloudId, failed: lookupFailed } = await resolveCloudId(userId, localId, cloudId);
  let derivativesOk = true;
  if (localId) {
    derivativesOk = await LocalStorageService.deleteDocument(localId, userId, { remove: true, cloudId: targetCloudId });
  } else if (targetCloudId) {
    await queueCloudRemoval(userId, targetCloudId);
  }
  let cloudSynced = !lookupFailed;
  if (targetCloudId && !lookupFailed) {
    try {
      // Замок облачной строки — общий со скачиванием, дренажом и восстановлением.
      // Занят — задача уже стоит, облако доделает дренаж.
      cloudSynced = await withDocumentLock(targetCloudId, async () => {
        if (!(await hasRemovalTask(userId, targetCloudId))) return false; // сняли восстановлением
        await CloudSyncService.removeCloudCopy(userId, targetCloudId);
        await clearCloudRemovalTasks(userId, targetCloudId);
        return true;
      }, { queueOnHeld: false, onLockHeld: () => false, ownerId: userId });
    } catch (e) {
      cloudSynced = false;
      // Задача уже стоит (поставлена до вызова облака); ставить её заново нельзя —
      // за время вызова её могло снять восстановление.
      reportError(e, { action: 'deleteDocument_cloudDelete', documentId: targetCloudId });
    }
  }
  // DY6-5 (приёмка 26.10, Н-1): сигнал живёт в ядре — любое применённое удаление
  // чистит производные (разбор, MiniSearch, кэш лексикона DY6-1), а не только
  // путь из архива. applied=false (замок/нет ряда) — события нет.
  emitDomainEvent({ type: 'note.deleted', documentId: localId ?? targetCloudId ?? '' });
  return { cloudSynced, derivativesOk, applied: true };
}

export const StorageService = {
  async saveNew(userId: string, data: SaveDocumentData): Promise<{ localId: string }> {
    // DY10-9: сохранение, вставшее на локальной базе, не молчит.
    return watchLocalDbStall('saveNew', LocalStorageService.saveNew(userId, data));
  },

  async saveVersion(userId: string, documentId: string, data: SaveDocumentData): Promise<SaveVersionResult> {
    return _lockManager.acquire(documentId, () => withTimeout(_doSaveVersion(userId, documentId, data), 60_000, 'Sync timeout'));
  },

  async addLocalCopy(userId: string, cloudDocumentId: string): Promise<{ localId: string; skippedVersions: number }> {
    return CloudSyncService.addLocalCopy(userId, cloudDocumentId);
  },

  async addCloudCopy(userId: string, localDocumentId: string): Promise<string> {
    return _lockManager.acquire(localDocumentId, () => CloudSyncService.addCloudCopy(userId, localDocumentId));
  },

  async removeLocalCopy(localDocumentId: string): Promise<boolean> {
    return LocalStorageService.deleteDocument(localDocumentId);
  },

  async removeCloudCopy(userId: string, cloudDocumentId: string, localDocumentId?: string): Promise<void> {
    return CloudSyncService.removeCloudCopy(userId, cloudDocumentId, localDocumentId);
  },

  async trashDocument(userId: string, localId?: string, cloudId?: string): Promise<{ cloudSynced: boolean }> {
    const { cloudId: targetCloudId, failed: lookupFailed } = await resolveCloudId(userId, localId, cloudId);
    const now = Date.now();
    if (localId) {
      await LocalDocumentService.trashDocument(localId, now, userId);
    }
    let cloudSynced = true;
    if (targetCloudId && !userId.startsWith('guest')) {
      try {
        await DocumentService.trashDocument(userId, targetCloudId, new Date(now));
      } catch (e) {
        // Без локальной копии досылать нечего: ничего не изменилось — это отказ,
        // а не «отправится позже» (находка 19.11; вызывающие показывают ошибку).
        if (!localId) throw e;
        cloudSynced = false;
        reportError(e, { action: 'trashDocument_cloud', documentId: targetCloudId });
        await queueMetadataRetry(userId, localId);
      }
    } else if (lookupFailed && localId && !userId.startsWith('guest')) {
      cloudSynced = false;
      await queueMetadataRetry(userId, localId);
    }
    return { cloudSynced };
  },

  async restoreDocument(userId: string, localId?: string, cloudId?: string): Promise<{ cloudSynced: boolean }> {
    const { cloudId: targetCloudId, failed: lookupFailed } = await resolveCloudId(userId, localId, cloudId);
    if (localId) {
      await LocalDocumentService.restoreDocument(localId, userId);
    }
    let cloudSynced = true;
    if (targetCloudId && !userId.startsWith('guest')) {
      try {
        await withCloudRowLock(userId, targetCloudId, async () => {
          // Восстановление сильнее прошлого «удалить навсегда»: задача, не доехавшая до
          // облака, снесла бы восстановленную заметку (дейлик 25.11).
          await clearCloudRemovalTasks(userId, targetCloudId);
          await DocumentService.restoreDocument(userId, targetCloudId);
        });
      } catch (e) {
        // Без локальной копии досылать нечего: ничего не изменилось — это отказ,
        // а не «отправится позже» (находка 19.11; вызывающие показывают ошибку).
        if (!localId) throw e;
        cloudSynced = false;
        reportError(e, { action: 'restoreDocument_cloud', documentId: targetCloudId });
        await queueMetadataRetry(userId, localId);
      }
    } else if (lookupFailed && localId && !userId.startsWith('guest')) {
      cloudSynced = false;
      await queueMetadataRetry(userId, localId);
    }
    return { cloudSynced };
  },

  async deleteDocument(userId: string, localId?: string, cloudId?: string): Promise<{ cloudSynced: boolean; derivativesOk: boolean; applied: boolean }> {
    if (!localId) return deleteDocumentUnlocked(userId, localId, cloudId);
    // R3-10: если дренаж как раз выгружает эту заметку впервые, облачный ряд
    // появится уже после удаления локальной — и downloadAllFromCloud её вернёт.
    // Ждём, пока выгрузка отпустит заметку, и удаляем под тем же замком.
    // A-2 (R2-005, R2-029): разблокированного выхода нет. Замок омолаживается
    // heartbeat'ом каждые ttl/3, поэтому «занят» может означать «работает»
    // сколько угодно долго; `withDocumentLock` сам перебивает протухший замок
    // (старше ttlMs), так что потолок нужен только против зависшей вкладки.
    const startedAt = Date.now();
    for (;;) {
      const res = await withDocumentLock(localId, () => deleteDocumentUnlocked(userId, localId, cloudId), {
        queueOnHeld: false,
        onLockHeld: () => null,
        ownerId: userId,
      });
      if (res) return res;
      if (Date.now() - startedAt >= LOCK_TTL_MS * 2) break;
      await new Promise(r => setTimeout(r, 500));
    }

    // Потолок пройден: удалять в обход замка нельзя — облачная запись живущей
    // выгрузки встала бы поверх нашего удаления. Фиксируем намерение: локальный
    // ряд снимается вместе с меткой «снести облачный ряд» (одна транзакция, см.
    // SB-2 в LocalDocumentService.deleteDocument), и дренаж доделает облако,
    // когда заметка освободится.
    const { cloudId: targetCloudId } = await resolveCloudId(userId, localId, cloudId);
    if (!targetCloudId) {
      // облачного ряда ещё нет — он как раз создаётся. Локальный ряд не трогаем:
      // без ссылки нечего и ставить в очередь, а удаление локальной копии
      // оставил бы в облаке сироту, который вернулся бы при следующем скачивании.
      reportError(
        new Error('Delete not applied: the note is still being uploaded and its cloud copy does not exist yet'),
        { action: 'deleteDocument_lockTimeout', documentId: localId },
        'warning',
      );
      return { cloudSynced: false, derivativesOk: false, applied: false };
    }
    const derivativesOk = await LocalStorageService.deleteDocument(localId, userId, { remove: true, cloudId: targetCloudId });
    // DY6-5: применённое удаление (см. выше) — сигнал из ядра и здесь.
    emitDomainEvent({ type: 'note.deleted', documentId: localId });
    return { cloudSynced: false, derivativesOk, applied: true };
  },

  async getStorageState(userId: string, localId?: string, cloudId?: string): Promise<StorageState> {
    const [localExists, cloudExists] = await Promise.all([
      localId ? LocalStorageService.getDocument(localId, userId).then(d => !!d) : Promise.resolve(false),
      // S0-5: ряд, который не разобрался, — это «ряд есть». Для плашки
      // «в облаке» это true: строка живёт на сервере, мы её просто не прочли.
      // Прочие ошибки (сеть, сейф) не глушим — статус обязан их показать.
      cloudId
        ? CloudSyncService.getDocument(userId, cloudId)
            .then(d => d !== null)
            .catch(e => (e instanceof UnreadableCloudRowError ? true : Promise.reject(e)))
        : Promise.resolve(false),
    ]);
    return { local: localExists, cloud: cloudExists };
  },
};

export type SaveVersionResult = {
  forked: boolean;
  forkTitle?: string | undefined;
  cloudSynced: boolean;
  reason?: string | undefined;
  isTooLarge?: boolean | undefined;
};

/**
 * DA-11 (владелец 27.11): название, теги и метка, изменённые в окне «Завершить» при
 * продолжении заметки, ложились только локально (LocalStorageService.saveVersionToLocal),
 * а в облако уходила одна версия — другие устройства их не видели никогда. Изменённые
 * поля метятся грязными (их же досылает дренаж, как правку из архива) и уходят сразу
 * после версии; отказ облака — задача в очереди.
 */
function changedMetadata(existing: LocalDocument, data: SaveDocumentData): MetadataField[] {
  const fields: MetadataField[] = [];
  if (data.title && data.title !== existing.title) fields.push('title');
  const before = existing.tags ?? [];
  if (data.tags !== undefined && (data.tags.length !== before.length || data.tags.some((t, i) => t !== before[i]))) fields.push('tags');
  if (data.labelId !== undefined && data.labelId !== existing.labelId) fields.push('labelId');
  return fields;
}

async function pushChangedMetadata(userId: string, documentId: string, cloudId: string, data: SaveDocumentData, fields: MetadataField[]): Promise<void> {
  try {
    await DocumentService.updateMetadataFields(userId, cloudId, { title: data.title, tags: data.tags, labelId: data.labelId }, fields);
    await LocalDocumentService.setMetadataDirty(documentId, false, userId);
  } catch (e) {
    reportError(e, { action: 'saveVersion_metadata', documentId });
    await addToSyncQueue(documentId, userId);
  }
}

async function _doSaveVersion(userId: string, documentId: string, data: SaveDocumentData): Promise<SaveVersionResult> {
  const now = Date.now();
  const totalWords = data.documentWordCount ?? data.wordCount;

  // DY10-9: сторож только на локальной части — отправка в облако (до 60 с на
  // плохой сети) не «зависшая база».
  const res = await watchLocalDbStall('saveVersion',
    getLocalDb(userId).then(db => LocalStorageService.saveVersionToLocal(db, documentId, data, now)));
  if (!res.ok) {
    throw new DOMException('Local save failed (quota exceeded)', 'QuotaExceededError');
  }
  const { newVersion, prevContent, existing } = res;
  const metaFields = existing.linkedCloudId ? changedMetadata(existing, data) : [];
  for (const field of metaFields) await LocalDocumentService.setMetadataDirty(documentId, true, userId, field);

  // Сигнал AI-домену (#105): правки должны догонять индекс эмбеддингов,
  // а не только при открытии страницы ИИ. Слушатель в features/ai вызывает
  // indexDocument — тот сам гейтируется согласием и хешем контента.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('doc-version-saved', { detail: { documentId } }));
  }

  await ProfileUpdater.updateLocalProfile(
    existing.guestId,
    existing.totalWords,
    totalWords,
    existing.totalDuration,
    data.duration,
    now
  );

  const isEncrypted = Boolean(getEncryptionEnabled(userId));
  const isTooLarge = isVersionContentTooLarge(data.content, isEncrypted);
  if (isTooLarge) {
    return { forked: false, cloudSynced: false, reason: 'TOO_LARGE', isTooLarge: true };
  }

  if (existing.linkedCloudId) {
    if (!cloudSyncEnabled(userId)) {
      await addToSyncQueue(documentId, userId);
      return { forked: false, cloudSynced: false };
    }
    const result = await CloudSyncService.syncVersionToCloud(
      userId,
      documentId,
      existing.linkedCloudId,
      data,
      newVersion,
      prevContent
    );
    if (result.forked) return { forked: true, forkTitle: result.forkTitle, cloudSynced: false };
    // Версия не ушла — поля остаются грязными, их дошлёт тот же дренаж, что и версию.
    if (metaFields.length > 0 && result.cloudSynced) {
      await pushChangedMetadata(userId, documentId, existing.linkedCloudId, data, metaFields);
    }
    return { forked: false, cloudSynced: result.cloudSynced, reason: result.reason };
  }
  return { forked: false, cloudSynced: false };
}
