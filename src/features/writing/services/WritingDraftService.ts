import { DataProvider } from '../../../core/data';
import { draftDbSchema } from '../../../core/data/schemas';
import { getLocalDb, LocalDraft } from '../../../core/storage/localDb';
import { toTimestampMs } from '../../../core/utils/dateUtils';
import { contentHash } from '../../../core/utils/contentHash';
import { maybeEncrypt, maybeDecrypt, isProfileLoaded } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import { withTimeout } from '../../../shared/utils/withTimeout';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { cloudSyncEnabled } from '../../../core/sync/cloudSyncEnabled';
import { pushSentHash, readSentHashes } from '../../../core/sync/sentHashes';
const DRAFT_CLOUD_FIELDS: Record<string, boolean> = {
  // Признак шифрования обязан уезжать вместе с данными. Без него колонка в
  // облаке хранит шифротекст, а читающая сторона считает его открытым текстом:
  // maybeDecrypt пытается разобрать pinnedThoughts как JSON, разбор падает — и
  // поле заменяется пустым массивом. Закреплённые мысли исчезали молча.
  _encrypted: true,
  content: true,
  title: true,
  pinnedThoughts: true,
  tags: true,
  labelId: true,
  wordCount: true,
  initialWordCount: true,
  activeSessionId: true,
  savedDocumentId: true,
  sessionStartTime: true,
  updatedAt: true,
};

const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const _draftGenerations = new Map<string, number>();
// Signature of what was last actually written to the cloud, per user.
const _lastCloudSignature = new Map<string, string>();

export function getDraftGeneration(userId: string): number {
  return _draftGenerations.get(userId) ?? 0;
}

export function bumpDraftGeneration(userId: string): number {
  const next = (_draftGenerations.get(userId) ?? 0) + 1;
  _draftGenerations.set(userId, next);
  return next;
}

// Fields worth a cloud draft write. The elapsed-time counters (seconds, wpm,
// accumulatedDuration, totalPauseSeconds, updatedAt) are deliberately absent:
// they change on their own while the writer sits still, so including them made
// the 30s cloud autosave rewrite the entire draft — full note content — every
// 30 seconds of an open session, typing or not. The local IndexedDB draft still
// carries exact timings; the cloud copy is the cross-device fallback, and its
// timer can lag until the text next changes.
const DRAFT_SIGNIFICANT_FIELDS = [
  'content', 'title', 'pinnedThoughts', 'tags', 'labelId',
  'wordCount', 'initialWordCount', 'activeSessionId', 'savedDocumentId', 'sessionStartTime',
] as const;

function draftSignature(draft: LocalDraft): string {
  const record = draft as unknown as Record<string, unknown>;
  return JSON.stringify(DRAFT_SIGNIFICANT_FIELDS.map(k => record[k] ?? null));
}

/**
 * SF2-1: короткая метка содержимого. Хранить саму подпись нельзя — она включает
 * весь текст черновика, а локальная копия не должна удваиваться ради службы
 * синхронизации.
 */
function draftPayloadHash(draft: LocalDraft): string {
  return contentHash(draftSignature(draft));
}

/** Форма `contentHash`: 16 шестнадцатеричных знаков. Отметка удаления чужой строкой не станет. */
const HASH_SHAPE = /^[0-9a-f]{16}$/;

/**
 * Все правки строки черновика в этой вкладке — одной цепочкой. `saveToLocal`
 * (текст) и `rememberCloudSend` (служебные метки) — два read-modify-write в
 * разных транзакциях, и без порядка один из них кладёт обратно строку, прочитанную
 * до чужой записи: теряется либо набор, либо хэш отправки. А хэш, потерянный при
 * обрыве ответа, ровно и нужен.
 */
let draftRowWrite: Promise<unknown> = Promise.resolve();

function queueDraftRowWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = draftRowWrite.then(fn, fn);
  draftRowWrite = run.catch(() => undefined);
  return run;
}

// Fields accepted by the cloud drafts table (DRAFT_FIELDS). The local
// draft carries extra transient state (e.g. `status`) that the rule rejects via
// hasOnly(), so only schema fields are sent to the cloud. `updatedAt` is set
// separately with a server timestamp.

function isDraftExpired(draft: LocalDraft): boolean {
  const updated = toTimestampMs(draft.updatedAt) ?? 0;
  return updated > 0 && Date.now() - updated > DRAFT_MAX_AGE_MS;
}

/** Серверная метка облачной версии, которую устройство видело последней; `null` — не помнит. */
function draftCloudSeen(draft: LocalDraft): number | null {
  const seen = (draft as unknown as Record<string, unknown>)._cloudUpdatedAt;
  return typeof seen === 'number' && Number.isFinite(seen) ? seen : null;
}

/** Хэш последних отправленных нагрузок; пустой список — не помним ни одной. */
function draftSentHashes(draft: LocalDraft): string[] {
  return readSentHashes((draft as unknown as Record<string, unknown>)._cloudSentHashes);
}

/** Хэш нагрузки, принятой облаком последней; `undefined` — не помним. */
function draftAckedHash(draft: LocalDraft): string | undefined {
  const hash = (draft as unknown as Record<string, unknown>)._cloudAckedHash;
  return typeof hash === 'string' ? hash : undefined;
}

/**
 * SF-2: спор локальной копии черновика и облачной решается СЕРВЕРНЫМИ метками с
 * обеих сторон, как `markCloudSeen` у заметок.
 *
 * Миграция 0043 перенесла `drafts.updated_at` на часы сервера, а локальную отметку
 * по-прежнему придумывает прибор (`buildLocalDraft`: `updatedAt: Date.now()`).
 * До 0043 оба числа были с одних часов, и сравнение было честным; после 0043 на
 * устройстве, чьи часы отстают больше чем на 60 с, облако побеждает ВСЕГДА:
 * облачную копию писатель отправляет только на заметных изменениях и не чаще раза
 * в 30 с, значит последние минуты набора всегда «старше» серверной метки. Текст
 * перезаписывался через `saveToLocal` — последний набор терялся.
 *
 * При запомненной метке часам прибора нет места в решении: облако новее ровно
 * тогда, когда его `updated_at` ушёл вперёд от версии, которую мы сами приняли.
 * `cloudTs = 0` («метки не прочитали») — локальная копия остаётся: «не знаю» не
 * имеет права означать «облако новее».
 *
 * SF2-1: «метка ушла вперёд» НЕ равно «правку сделал кто-то другой». Облако
 * уходит вперёд и по нашей собственной записи, ответ на которую потерян
 * (`DataProvider.saveDraft` бросает уже после коммита — отметка не запомнена, а
 * строка в облаке лежит). Человек дописывает, приложение перезапускается, и
 * прежняя ветка `cloudTs > cloudSeen` отдавала облаку НАШУ же прошлую версию:
 * дописанное после сгорало в `saveToLocal`. Так же терялся текст между
 * устройствами, когда A правит офлайн после записи B.
 *
 * Различает эти исходы хэш последних ОТПРАВЛЕННЫХ нагрузок:
 *   • `cloudIsOurs` — содержимое облака совпало с одной из последних отправок:
 *     дошла наша запись, ответа мы не видели. Локальная копия новее неё по
 *     построению, затирать её нельзя;
 *   • `localDirty === false` — после принятой записи здесь ничего не менялось:
 *     всё новое в облаке чужое, берём облако (как в SF-2);
 *   • `localDirty === true` и облако чужое — настоящий спор. Он решается ровно
 *     тем правилом, что действовало на `main` до 0043 (коридор 60 с по числу слов,
 *     иначе свежесть), поэтому ни один исход не хуже `main`. «Облачное в
 *     оригинал, своё в копию» из плана §2 для черновика применить нечем: копия у
 *     черновика одна, места для проигравшей нет — это решение владельца.
 *
 * Без запомненной метки и без хэшей (черновики, написанные до правки) остаётся
 * прежнее правило по часам — переходный путь, он живёт один цикл, пока прибор хоть
 * раз не напишется в облако или не примет облачную копию.
 */
export function decideDraftCopy(o: {
  cloudSeen: number | null;
  cloudTs: number;
  localTs: number;
  localWords: number;
  cloudWords: number;
  /** Облачное содержимое совпало с одной из последних отправленных нами нагрузок. */
  cloudIsOurs?: boolean | undefined;
  /** После принятой облачной записи в локальной копии есть правки; `undefined` — не знаем. */
  localDirty?: boolean | undefined;
}): 'cloud' | 'local' {
  /*gate:clock-rule*/
  // Участок правила спора копий: здесь запрещено читать часы устройства
  // (`Date.now()`, `new Date()` без аргумента). Гейт — src/test/syncRuleGates.s06.test.ts (S0-6).
  const byClock = (): 'cloud' | 'local' => {
    if (Math.abs(o.localTs - o.cloudTs) < 60_000) return o.localWords >= o.cloudWords ? 'local' : 'cloud';
    return o.localTs > o.cloudTs ? 'local' : 'cloud';
  };
  if (o.cloudSeen === null) return o.cloudIsOurs ? 'local' : byClock();
  if (o.cloudTs <= o.cloudSeen) return 'local';
  if (o.cloudIsOurs) return 'local';
  if (o.localDirty === true) return byClock();
  return 'cloud';
  /*endgate:clock-rule*/
}

function hasDraftsStore(localDb: { objectStoreNames: DOMStringList }): boolean {
  return localDb.objectStoreNames.contains('drafts');
}

export const WritingDraftService = {
  _cloudDraftLocked: false,
  isCloudDraftLocked: () => WritingDraftService._cloudDraftLocked,
  getDraftGeneration,
  bumpDraftGeneration,

  loadDraft: async (userId: string): Promise<LocalDraft | null> => {
    let deletedAt = 0;
    // SF2-6: хэш ТОГО, что удалили. Время здесь не различает воскрешение и
    // новую работу: после 0043 `updated_at` ряда ставят серверные часы, а
    // отметка удаления — часы прибора, и на отстающем устройстве любое
    // сохранение в полёте, пришедшее после удаления, выглядит «новее удаления».
    // SF3-4: список, а не один хэш — в момент удаления локальная строка это
    // ПОСЛЕДНЯЯ правка, а в облако из полёта доезжает версия, которая была в
    // строке раньше. Её хэш живёт в списке неотправленных (`_cloudSentHashes`)
    // и в хэше принятой, и все они — про то же удалённое содержимое.
    let deletedHashes: string[] = [];
    try {
      const s = sessionStorage.getItem(STORAGE_KEYS.DRAFT_DELETED(userId));
      if (s) {
        const sep = s.indexOf('|');
        deletedAt = parseInt(sep < 0 ? s : s.slice(0, sep), 10);
        const tail = sep < 0 ? '' : s.slice(sep + 1);
        deletedHashes = tail.split(',').filter(h => HASH_SHAPE.test(h));
      }
    } catch (e) { reportError(e, { action: 'loadDraft_sessionStorageRead', userId }); }
    /** Черновик, удалённый на этом устройстве: по содержимому, а не по часам. */
    const isDeletedDraft = (draft: LocalDraft): boolean =>
      deletedHashes.includes(draftPayloadHash(draft));

    const [localResult, legacyResult, cloudResult] = await Promise.allSettled([
      (async () => {
        const localDb = await getLocalDb(userId);
        if (hasDraftsStore(localDb)) {
          return await localDb.get('drafts', userId) ?? null;
        }
        return null;
      })(),
      (async () => {
        const raw = localStorage.getItem(STORAGE_KEYS.DRAFT(userId));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.content) return { ...parsed, userId } as LocalDraft;
        }
        return null;
      })(),
      withTimeout((async () => {
        const draftData = await DataProvider.getDraft(userId);
        if (draftData) {
          const decrypted: unknown = await maybeDecrypt(draftData, ['content', 'title'], ['pinnedThoughts', 'tags']);
          // Битый облачный черновик не доходит до таймеров и сравнений дат:
          // локальная копия побеждает, мусор в состояние приложения не входит.
          const parsed = draftDbSchema.safeParse(decrypted);
          if (!parsed.success) {
            reportError(parsed.error, { action: 'loadDraft_cloud_invalid', userId });
            return null;
          }
          return parsed.data as unknown as LocalDraft;
        }
        return null;
      })(), 10000),
    ]);

    const localFailed = localResult.status === 'rejected';
    if (localFailed) {
      reportError(localResult.reason, { action: 'loadDraft_local_failed', userId });
    }
    const localDraft: LocalDraft | null = localResult.status === 'fulfilled' ? localResult.value : null;

    const legacyFailed = legacyResult.status === 'rejected';
    if (legacyFailed) {
      reportError(legacyResult.reason, { action: 'loadDraft_legacy_failed', userId });
    }
    const legacyDraft: LocalDraft | null = legacyResult.status === 'fulfilled' ? legacyResult.value : null;
    let cloudDraft: LocalDraft | null = null;

    if (cloudResult.status === 'fulfilled') {
      cloudDraft = cloudResult.value;
      WritingDraftService._cloudDraftLocked = false;
    } else {
      const reason = cloudResult.reason as Error | undefined;
      if (
        reason?.message?.startsWith('LOCKED') ||
        reason?.message?.includes('session key not available')
      ) {
        WritingDraftService._cloudDraftLocked = true;
      }
    }

    const resolvedLocal = localDraft || legacyDraft;

    if (resolvedLocal && cloudDraft) {
      const localTs = toTimestampMs(resolvedLocal.updatedAt) ?? 0;
      const cloudTs = toTimestampMs(cloudDraft.updatedAt) ?? 0;
      // SF2-1: два признака, которых часовому правилу не хватало. Хэш облачной
      // строки считается по прочитанной (расшифрованной) копии, поэтому совпадает
      // с хэшем отправленной нагрузки ровно тогда, когда в облаке лежит ОНА ЖЕ.
      // Отсутствие хэшей — «не знаю», и правило остаётся прежним.
      const sentHashes = draftSentHashes(resolvedLocal);
      const ackedHash = draftAckedHash(resolvedLocal);
      const cloudHash = draftPayloadHash(cloudDraft);
      const winner: LocalDraft = decideDraftCopy({
        cloudSeen: draftCloudSeen(resolvedLocal),
        cloudTs,
        localTs,
        localWords: resolvedLocal.wordCount ?? 0,
        cloudWords: cloudDraft.wordCount ?? 0,
        cloudIsOurs: sentHashes.includes(cloudHash),
        localDirty: ackedHash === undefined ? undefined : draftPayloadHash(resolvedLocal) !== ackedHash,
      }) === 'cloud' ? cloudDraft : resolvedLocal;
      if (deletedAt && (isDeletedDraft(winner) || (toTimestampMs(winner.updatedAt) ?? 0) <= deletedAt)) {
        await WritingDraftService.deleteDraft(userId); // намеренно: удаление удалённого черновика
        return null;
      }
      if (isDraftExpired(winner)) {
        await WritingDraftService.deleteDraft(userId); // намеренно: удаление просроченного черновика
        return null;
      }
      if (winner === cloudDraft && !localFailed) {
        // SF-2: принятая облачная копия запоминает СВОЮ серверную метку — иначе
        // следующий забор сравнивал бы её же с часами прибора.
        // SF2-1: и её хэш — принятая копия становится нашей базой, иначе следующая
        // перезагрузка сочла бы её чужой и спор решился бы по часам.
        // SF3-1: и список неотправленных закрывается этим же хэшем — прежние
        // «уехало без ответа» с принятой облачной копией не согласуются.
        await WritingDraftService.saveToLocal({ ...cloudDraft, _cloudUpdatedAt: cloudTs, _cloudAckedHash: cloudHash, _cloudSentHashes: [cloudHash] })
          .catch(() => { /* намеренно: фоновое кэширование черновика из облака */ });
      }
      return winner;
    }
    const resolved = resolvedLocal || cloudDraft;
    if (resolved) {
      if (deletedAt && (isDeletedDraft(resolved) || (toTimestampMs(resolved.updatedAt) ?? 0) <= deletedAt)) {
        if (!localFailed) await WritingDraftService.deleteDraft(userId); // намеренно: удаление удалённого черновика
        return null;
      }
      if (isDraftExpired(resolved)) {
        if (!localFailed) await WritingDraftService.deleteDraft(userId); // намеренно: удаление просроченного черновика
        return null;
      }
      if (resolved === cloudDraft && !localFailed) {
        // SF3-1: принятая копия — она же единственная отправка, о которой мы знаем.
        await WritingDraftService.saveToLocal({ ...cloudDraft, _cloudUpdatedAt: toTimestampMs(cloudDraft.updatedAt) ?? undefined, _cloudAckedHash: draftPayloadHash(cloudDraft), _cloudSentHashes: [draftPayloadHash(cloudDraft)] })
          .catch(() => { /* намеренно: фоновое кэширование черновика из облака */ });
      }
    }
    return resolved;
  },

  clearLegacyDraft: async (userId: string) => {
    try {
      localStorage.removeItem(STORAGE_KEYS.DRAFT(userId));
    } catch (e) { reportError(e, { action: 'clearLegacyDraft', userId }); }
  },

  /** true — записано; false — пропущено: черновик устарел (поколение подняли:
   *  сессию сохранили заметкой, отменили или сменили) или нет владельца. Пропуск —
   *  не запись, и «Сохранено» по нему показывать нельзя (N-33). */
  saveToLocal: async (draft: LocalDraft, generation?: number): Promise<boolean> => {
    if (!draft.userId) {
      return false;
    }
    if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
      return false;
    }
    try {
      const localDb = await getLocalDb(draft.userId);
      if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
        return false;
      }
      // SF-2/SF2-1: серверный штамп принятой облачной версии и хэши отправок —
      // служебные поля локальной копии. Писатель строит черновик из состояния
      // редактора и принести их не может, а терять нельзя: без них спор снова
      // решают часы прибора, и своя же дошедшая запись выглядит чужой.
      await queueDraftRowWrite(async () => {
        const tx = localDb.transaction('drafts', 'readwrite');
        const previous = await tx.store.get(draft.userId);
        const seen = draft._cloudUpdatedAt ?? previous?._cloudUpdatedAt;
        const acked = draft._cloudAckedHash ?? previous?._cloudAckedHash;
        const sent = draft._cloudSentHashes ?? previous?._cloudSentHashes;
        const next: LocalDraft = { ...draft };
        if (seen !== undefined) next._cloudUpdatedAt = seen;
        if (acked !== undefined) next._cloudAckedHash = acked;
        if (sent !== undefined) next._cloudSentHashes = sent;
        await tx.store.put(next);
        await tx.done;
      });
      return true;
    } catch (err) {
      if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
        return false;
      }
      reportError(err, { action: 'saveToLocal', userId: draft.userId });
      // D-1: re-throw so Promise.allSettled sees 'rejected' and localOk is
      // false — prevents the UI from showing "Saved" when the draft is lost.
      throw err;
    }
  },

  /**
   * SF2-1/SF-2: запомнить отправку черновика в облако.
   *
   * Вызывается ДВАЖДЫ на одну запись: до запроса — с хэшем уехавшей нагрузки, и
   * после принятого ответа — с ним же плюс серверная метка принятой версии (тот
   * же смысл, что `markCloudSeen` у заметок). Порядок важен: ответ на запись
   * рвётся уже после коммита на сервере, и если хэш писать только по успеху,
   * своя же дошедшая копия на следующей загрузке выглядит чужой и затирает
   * дописанное.
   *
   * Локальной копии нет — отметки нет: нечего помечать, а не «облако пустое».
   *
   * SF3-1: принятая запись закрывает список. Его смысл — «уехало и ответа мы не
   * видели», а с ответом на эту же нагрузку все прежние отправки становятся либо
   * той версией, которая под этой уже лежит в облаке, либо тем, что туда не
   * попало никогда. Держать их дальше — это и рост списка, и будущее «наше» по
   * содержимому, которое перестало быть нашим.
   */
  rememberCloudSend: async (
    userId: string,
    hash: string,
    accepted?: { stampMs?: number | null },
  ): Promise<void> => {
    if (!userId || !hash) return;
    try {
      const localDb = await getLocalDb(userId);
      await queueDraftRowWrite(async () => {
        const tx = localDb.transaction('drafts', 'readwrite');
        const stored = await tx.store.get(userId);
        if (stored) {
          const next: LocalDraft = { ...stored, _cloudSentHashes: pushSentHash(draftSentHashes(stored), hash) };
          if (accepted) {
            next._cloudAckedHash = hash;
            next._cloudSentHashes = [hash];
            const stampMs = accepted.stampMs;
            if (typeof stampMs === 'number' && Number.isFinite(stampMs)) next._cloudUpdatedAt = stampMs;
          }
          await tx.store.put(next);
        }
        await tx.done;
      });
    } catch (err) {
      reportError(err, { action: 'rememberDraftCloudSend', userId });
    }
  },

  // Раньше называлось saveToFirestore, и это же имя уходило в журнал ошибок.
  // Firestore здесь нет с момента переезда — внутри DataProvider.saveDraft, то
  // есть Supabase, — но сообщение «Firestore save failed» отправляло искать
  // причину в мёртвом слое. Имя в журнале должно называть то место, где отказ
  // случился на самом деле.
  saveDraftToCloud: async (draft: LocalDraft, generation?: number): Promise<boolean> => {
    if (!draft.userId) return false;
    if (!cloudSyncEnabled(draft.userId)) return false;
    if (!isProfileLoaded(draft.userId)) {
      return false;
    }
    if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
      return false;
    }
    // Nothing worth writing changed since the last successful write. Reported as
    // success: the cloud copy IS current, which is what the caller's staleness
    // flag asks about.
    const signature = draftSignature(draft);
    if (_lastCloudSignature.get(draft.userId) === signature) return true;
    const hash = draftPayloadHash(draft);

    const draftRecord = draft as unknown as Record<string, unknown>;
    const encrypted = await maybeEncrypt(draftRecord, ['content', 'title'], ['pinnedThoughts', 'tags'], draft.userId);
    if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
      return false;
    }
    const clean = Object.fromEntries(
      Object.entries(encrypted).filter(([k, v]) => v !== undefined && (k in DRAFT_CLOUD_FIELDS))
    );
    try {
      if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
        return false;
      }
      // SF2-1: хэш уехавшей нагрузки фиксируется ДО запроса. Ответ может
      // оборваться уже после коммита на сервере — тогда при следующей загрузке
      // облачная строка будет нашей, а не чужой, и локальный набор не сотрётся.
      await WritingDraftService.rememberCloudSend(draft.userId, hash);
      const cloudStamp = await DataProvider.saveDraft(draft.userId, clean);
      _lastCloudSignature.set(draft.userId, signature);
      // SF-2: метку принятой версии двигаем ТОЛЬКО на принятой записи. Отказ или
      // разрыв ответа — «не знаю», и прежняя метка остаётся: на «не знаю»
      // правило хранит локальную.
      await WritingDraftService.rememberCloudSend(draft.userId, hash, { stampMs: cloudStamp });
      return true;
    } catch (e) {
      if (generation !== undefined && generation !== getDraftGeneration(draft.userId)) {
        return false;
      }
      reportError(e, { action: 'saveDraftToCloud', userId: draft.userId });
      throw e;
    }
  },

  /** true — локальный черновик удалён (или его не было). false — не удалось:
   *  он может всплыть «несохранённым черновиком» поверх сохранённой заметки. */
  deleteDraft: async (userId: string): Promise<boolean> => {
    if (!userId) return true;
    let localOk = true;
    bumpDraftGeneration(userId);
    // The next draft must be written even if it opens with identical text.
    _lastCloudSignature.delete(userId);
    // SF2-6: над отметкой удаления — хэш удалённого содержимого. Различает
    // «приехло то, что я удалил» от «приехло новый черновик», когда сравнивать
    // часы нельзя (метка ряда после 0043 серверная, отметка — приборная).
    // SF3-4: версий такой хэш несколько. В момент удаления локальная строка —
    // это ПОСЛЕДНЯЯ правка, а из полёта в облако доезжает та, что была в строке
    // раньше (её след живёт в `_cloudSentHashes`), плюс ранее принятая. Все они —
    // про одно и то же удалённое содержимое, и ни одна не имеет права воскреснуть.
    // Прочитать не удалось (сейф заперт, база сломана, локальной копии нет) —
    // отметка остаётся временной: прежняя сверка, а не «удаления не было».
    let deletedHashes: string[] = [];
    try {
      const localDb = await getLocalDb(userId);
      if (hasDraftsStore(localDb)) {
        const row = await localDb.get('drafts', userId);
        if (row) {
          const acked = draftAckedHash(row);
          deletedHashes = [...new Set([
            draftPayloadHash(row),
            ...(acked !== undefined ? [acked] : []),
            ...draftSentHashes(row),
          ])].filter(h => HASH_SHAPE.test(h));
        }
      }
    } catch (e) { reportError(e, { action: 'deleteDraft_readForHash', userId }); }
    const deletedTail = deletedHashes.join(',');
    try {
      sessionStorage.setItem(STORAGE_KEYS.DRAFT_DELETED(userId), `${Date.now()}${deletedTail ? `|${deletedTail}` : ''}`);
    } catch (e) { reportError(e, { action: 'deleteDraft_sessionStorageWrite', userId }); }
    try {
      const localDb = await getLocalDb(userId);
      if (hasDraftsStore(localDb)) {
        await localDb.delete('drafts', userId);
      }
    } catch (err) {
      localOk = false;
      reportError(err, { action: 'deleteDraft_local', userId });
    }
    try {
      localStorage.removeItem(STORAGE_KEYS.DRAFT(userId));
    } catch (e) { reportError(e, { action: 'deleteDraft_legacyLocalStorage', userId }); }
    try {
      await DataProvider.deleteDraft(userId);
    } catch (err) {
      reportError(err, { action: 'deleteDraft_cloud', userId });
    }
    return localOk;
  }
};
