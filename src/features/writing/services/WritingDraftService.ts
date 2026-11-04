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
import {
  applyWrite,
  applySave,
  isEpochStale,
  getDraftGeneration,
  bumpDraftGeneration,
  queueDraftRowWrite,
  type ApplyWriteOutcome,
  type DraftRecord,
  type DraftWriteBasis,
} from './draftWriter';
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
// Signature of what was last actually written to the cloud, per user.
const _lastCloudSignature = new Map<string, string>();

// DW4-2: эпоха черновика (`getDraftGeneration`/`bumpDraftGeneration`) и очередь
// правок строки переехали в мутатор `draftWriter.applyWrite` — один источник
// эпохи и один писатель на оба локальных адреса. Сервис импортирует их оттуда
// и отдаёт членам объекта ниже; собственных сверок поколения у локальной
// записи больше нет.

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
 * DW4-2: очередь правок строки — в `draftWriter` (мутатор), одной цепочкой для
 * всех писателей. `rememberCloudSend` ниже встаёт в ту же цепочку: текст и
 * служебные метки облака — два read-modify-write одной строки (SF2-1).
 */

// Fields accepted by the cloud drafts table (DRAFT_FIELDS). The local
// draft carries extra transient state (e.g. `status`) that the rule rejects via
// hasOnly(), so only schema fields are sent to the cloud. `updatedAt` is set
// separately with a server timestamp.

/** Серверная метка облачной версии, которую устройство видело последней; `null` — не помнит. */
function draftCloudSeen(draft: LocalDraft): number | null {
  const seen = (draft as unknown as Record<string, unknown>)._cloudUpdatedAt;
  return typeof seen === 'number' && Number.isFinite(seen) ? seen : null;
}

/**
 * D1-2: сравнивать метку ряда с `deletedAt` (часы этого прибора) можно, только
 * если её поставил он же. У облачной строки после 0043 метка серверная; у копии,
 * принятой из облака, — тоже (она хранит серверный штамп). У правки человека —
 * `Date.now()` прибора.
 */
function draftStampFromDevice(draft: LocalDraft, fromCloud: boolean): boolean {
  if (fromCloud) return false;
  const seen = draftCloudSeen(draft);
  return seen === null || toTimestampMs(draft.updatedAt) !== seen;
}

/**
 * D1-6: срок считает прибор (`Date.now()`), значит и метка черновика обязана быть
 * приборной. У облачной копии после 0043 метку ставит сервер; сравнивать её с
 * часами устройства нельзя — спешащий прибор объявлял свежий чужой черновик
 * просроченным и сносил его вместе с облачной копией.
 */
function isDraftExpired(draft: LocalDraft, fromCloud: boolean): boolean {
  if (!draftStampFromDevice(draft, fromCloud)) return false;
  const updated = toTimestampMs(draft.updatedAt) ?? 0;
  return updated > 0 && Date.now() - updated > DRAFT_MAX_AGE_MS;
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

/**
 * N1-4: из двух локальных копий — строки IndexedDB и снимка закрытия вкладки
 * (`draft-<uid>`, W14 `useDraftCore.ts:272-284`) — берётся НОВЕЕ по `updatedAt`.
 * Прежний выбор `localDraft || legacyDraft` читал копию только когда строки нет
 * совсем: набранное в отсрочке между правкой и записью в базу проигрывало более
 * старой строке, а `clearLegacyDraft` (`useSessionPersistence.ts:109`) стирал
 * ключ с этими словами — потеря окончательная.
 *
 * Ничья и «даты нет» — IndexedDB: у строки полная форма, у копии — снимок.
 *
 * Поля, которых в снимке нет, доезжают со строкой: без `savedDocumentId`
 * следующее сохранение завело бы БУКВУ вместо версии (тот же класс, что DW-F-2 у
 * гостя), а без `_cloudUpdatedAt`/`_cloudAckedHash`/`_cloudSentHashes` следующий
 * спор с облаком потерял бы память и вернулся к часам (SF-2, SF2-1).
 *
 * Это единственная функция выбора локальной копии; спор с облаком
 * (`decideDraftCopy`) остаётся над ней и работает с уже выбранной копией.
 */
const UNLOAD_COPY_GAPS: readonly string[] = [
  'savedDocumentId', 'accumulatedDuration', 'totalPauseSeconds', 'initialWordCount',
  '_cloudUpdatedAt', '_cloudAckedHash', '_cloudSentHashes',
];

/** Копия проигравшего адреса не выбрасывается: поля, которых в ней нет, доезжают. */
function withCarriedFields(winner: LocalDraft, other: LocalDraft): LocalDraft {
  const carried: Record<string, unknown> = {};
  for (const field of UNLOAD_COPY_GAPS) {
    const key = field as keyof LocalDraft;
    if (winner[key] === undefined && other[key] !== undefined) {
      carried[field] = other[key];
    }
  }
  return Object.keys(carried).length > 0
    ? ({ ...winner, ...carried } as unknown as LocalDraft)
    : winner;
}

export function pickNewerLocalCopy(
  idb: LocalDraft | null,
  unload: LocalDraft | null,
): LocalDraft | null {
  if (!idb) return unload;
  if (!unload) return idb;

  // Самопроверка (сверка 27): сравнивать можно только часы одного прибора (D1-2).
  // Метка строки базы бывает СЕРВЕРНОЙ — когда копия была принята из облака
  // (`saveToLocal({ ...cloudDraft, _cloudUpdatedAt: cloudTs })`, и у такой копии
  // `updatedAt` = `draftCloudSeen`). На приборе, который отстаёт от сервера,
  // правило «больше по числу» снова отдавало старую облачную строку и теряло
  // последние слова, то есть N1-4 работал только при точных часах.
  // Копия закрытия вкладки штампуется прибором (`useDraftCore.ts:283`) и живёт в
  // адресе только если после последней принятой локальной записи случилось
  // закрытие: `persistDraft` снимает ключ на каждой удачной записи
  // (`draftPersistence.ts:80-82`), а удаление — в обеих половинах. Значит она —
  // работа более поздняя. Даты в копии нет — не угадываем, остаётся строка.
  if (!draftStampFromDevice(idb, false)) {
    return toTimestampMs(unload.updatedAt) === null
      ? withCarriedFields(idb, unload)
      : withCarriedFields(unload, idb);
  }

  const idbTs = toTimestampMs(idb.updatedAt) ?? 0;
  const unloadTs = toTimestampMs(unload.updatedAt) ?? 0;
  return unloadTs > idbTs ? withCarriedFields(unload, idb) : withCarriedFields(idb, unload);
}

interface DraftTombstone { deletedAt: number; hashes: string[] }

function parseTombstone(raw: string | null): DraftTombstone | null {
  if (!raw) return null;
  const sep = raw.indexOf('|');
  const deletedAt = parseInt(sep < 0 ? raw : raw.slice(0, sep), 10);
  if (!Number.isFinite(deletedAt)) return null;
  const tail = sep < 0 ? '' : raw.slice(sep + 1);
  return { deletedAt, hashes: tail.split(',').filter(h => HASH_SHAPE.test(h)) };
}

/**
 * AP2-4: надгробие в sessionStorage умирало вместе с вкладкой, и удалённый
 * черновик возвращался из облака. Вторая копия живёт в localStorage: только
 * время и хэши удалённого содержимого, без текста.
 */
function readTombstone(userId: string): DraftTombstone | null {
  let marks: Array<DraftTombstone | null> = [];
  try { marks = [parseTombstone(sessionStorage.getItem(STORAGE_KEYS.DRAFT_DELETED(userId)))]; } catch (e) { reportError(e, { action: 'loadDraft_sessionStorageRead', userId }); }
  try { marks.push(parseTombstone(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETED_PERSISTENT(userId)))); } catch (e) { reportError(e, { action: 'loadDraft_persistentTombstoneRead', userId }); }
  const found = marks.filter((m): m is DraftTombstone => m !== null);
  if (found.length === 0) return null;
  return {
    deletedAt: Math.max(...found.map(m => m.deletedAt)),
    hashes: [...new Set(found.flatMap(m => m.hashes))],
  };
}

// Ревью AP2: список сливается с прежним — повторное удаление без локальной
// строки иначе стирало хэши, и оставалось одно правило по часам устройства.
// ponytail: хвост в 32 хэша; удалённое раньше давно вытеснено из облака.
const TOMBSTONE_MAX_HASHES = 32;

function writeTombstone(userId: string, deletedAt: number, newHashes: string[]): void {
  const hashes = [...new Set([...newHashes, ...(readTombstone(userId)?.hashes ?? [])])].slice(0, TOMBSTONE_MAX_HASHES);
  const value = `${deletedAt}${hashes.length ? `|${hashes.join(',')}` : ''}`;
  try { sessionStorage.setItem(STORAGE_KEYS.DRAFT_DELETED(userId), value); } catch (e) { reportError(e, { action: 'deleteDraft_sessionStorageWrite', userId }); }
  try { localStorage.setItem(STORAGE_KEYS.DRAFT_DELETED_PERSISTENT(userId), value); } catch (e) { reportError(e, { action: 'deleteDraft_persistentTombstone', userId }); }
}

function clearPendingCloudDelete(userId: string): void {
  try { localStorage.removeItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(userId)); } catch { /* намеренно: отметка — подсказка, не данные */ }
}

/**
 * AP2-4: облачное удаление, не дошедшее в прошлый раз, досылается при загрузке.
 * Приёмка 0.10.6: только если в облаке лежит ИМЕННО удалённое содержимое (хэш из
 * надгробия). После неудачного удаления в облако мог уехать новый черновик — с
 * этого устройства или с другого; слепое удаление стёрло бы его облачную копию.
 * Не прочиталось — ничего не удаляем и отметку держим: «нет ответа» не «можно».
 */
async function flushPendingCloudDelete(userId: string, deletedHashes: readonly string[]): Promise<void> {
  try {
    if (localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(userId)) === null) return;
  } catch { return; }
  try {
    const row = await DataProvider.getDraft(userId);
    if (!row) { clearPendingCloudDelete(userId); return; }
    const parsed = draftDbSchema.safeParse(await maybeDecrypt(row, ['content', 'title'], ['pinnedThoughts', 'tags']));
    if (!parsed.success) return;
    if (!deletedHashes.includes(draftPayloadHash(parsed.data as unknown as LocalDraft))) {
      clearPendingCloudDelete(userId);
      return;
    }
    await DataProvider.deleteDraft(userId);
    clearPendingCloudDelete(userId);
  } catch (e) {
    reportError(e, { action: 'deleteDraft_retry', userId });
  }
}

async function deleteDraftLocalPart(userId: string): Promise<{ localOk: boolean }> {
  let localOk = true;
  // Шаг 5 DW-4: закрытие черновика поднимает эпоху в мутаторе — отсюда и из
  // `cleanupDraftsAfterSave`. Прежние вызывающие поднимали её сами, и на
  // сохранении это было два подъёма подряд, а на новом писателе — ноль.
  applySave(userId);
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
  writeTombstone(userId, Date.now(), deletedHashes);
  // BR-1 (а): отметка досылки ставится здесь, а не в облачной половине. Офлайн-
  // финиш (`cleanupDraftsAfterSave` без сети) зовёт только эту функцию, и без
  // отметки старая облачная строка оставалась живой до следующего удаления —
  // а при следующей загрузке спор копий решался в её пользу.
  try {
    localStorage.setItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(userId), String(Date.now()));
  } catch { /* намеренно: без отметки облако снесёт обычная ветка удаления */ }
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
  return { localOk };
}

async function deleteDraftCloudPart(userId: string): Promise<{ cloudOk: boolean }> {
  let cloudOk = true;
  try {
    await DataProvider.deleteDraft(userId);
    try { localStorage.removeItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(userId)); } catch { /* намеренно: отметка досылки — подсказка, не данные */ }
  } catch (err) {
    cloudOk = false;
    reportError(err, { action: 'deleteDraft_cloud', userId });
    try { localStorage.setItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(userId), String(Date.now())); } catch { /* намеренно: без отметки следующий deleteDraft повторит облако */ }
  }
  return { cloudOk };
}

export const WritingDraftService = {
  _cloudDraftLocked: false,
  isCloudDraftLocked: () => WritingDraftService._cloudDraftLocked,
  getDraftGeneration,
  bumpDraftGeneration,

  loadDraft: async (userId: string): Promise<LocalDraft | null> => {
    // SF2-6: хэш ТОГО, что удалили. Время здесь не различает воскрешение и
    // новую работу: после 0043 `updated_at` ряда ставят серверные часы, а
    // отметка удаления — часы прибора, и на отстающем устройстве любое
    // сохранение в полёте, пришедшее после удаления, выглядит «новее удаления».
    // SF3-4: список, а не один хэш — в момент удаления локальная строка это
    // ПОСЛЕДНЯЯ правка, а в облако из полёта доезжает версия, которая была в
    // строке раньше. Её хэш живёт в списке неотправленных (`_cloudSentHashes`)
    // и в хэше принятой, и все они — про то же удалённое содержимое.
    // AP2-4: читаются обе копии — вкладки и пережившая её.
    const tombstone = readTombstone(userId);
    const deletedAt = tombstone?.deletedAt ?? 0;
    const deletedHashes = tombstone?.hashes ?? [];
    /** Черновик, удалённый на этом устройстве: по содержимому, а не по часам. */
    const isDeletedDraft = (draft: LocalDraft): boolean =>
      deletedHashes.includes(draftPayloadHash(draft));
    /**
     * D1-2: надгробие судит по хэшу. Временна́я ветка остаётся только для метки,
     * поставленной этим прибором: серверную метку облачной строки сравнивать с
     * `deletedAt` нельзя — спешащие часы объявляли чужой свежий черновик «старее
     * удаления», и он сносился из облака. Не знаем — не удаляем.
     */
    const isDeletedByTombstone = (draft: LocalDraft, fromCloud: boolean): boolean => {
      if (!deletedAt) return false;
      if (isDeletedDraft(draft)) return true;
      if (!draftStampFromDevice(draft, fromCloud)) return false;
      return (toTimestampMs(draft.updatedAt) ?? 0) <= deletedAt;
    };

    await flushPendingCloudDelete(userId, deletedHashes);

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

    // N1-4: новая из двух локальных копий, а не «IndexedDB, если он вообще есть».
    const resolvedLocal = pickNewerLocalCopy(localDraft, legacyDraft);

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
      if (isDeletedByTombstone(winner, winner === cloudDraft)) {
        // BR-1 (б): надгробие догнало облачный победитель — это та строка, что
        // удалили на этом приборе. Локальная копия при этом своя, новая работа, и
        // `deleteDraft` снёс бы её вместе с облаком. Удаляем только облачную
        // половину и отдаём локальную.
        if (winner === cloudDraft && !isDeletedByTombstone(resolvedLocal, false) && !isDraftExpired(resolvedLocal, false)) {
          await deleteDraftCloudPart(userId); // намеренно: исход облака не меняет ответ — при отказе половина сама держит отметку досылки
          return resolvedLocal;
        }
        await WritingDraftService.deleteDraft(userId); // намеренно: удаление удалённого черновика
        return null;
      }
      if (isDraftExpired(winner, winner === cloudDraft)) {
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
        await WritingDraftService.saveToLocal({ ...cloudDraft, owner: userId, _cloudUpdatedAt: cloudTs, _cloudAckedHash: cloudHash, _cloudSentHashes: [cloudHash] })
          .catch(() => { /* намеренно: фоновое кэширование черновика из облака */ });
      }
      return winner;
    }
    const resolved = resolvedLocal || cloudDraft;
    if (resolved) {
      if (isDeletedByTombstone(resolved, resolved === cloudDraft)) {
        if (!localFailed) await WritingDraftService.deleteDraft(userId); // намеренно: удаление удалённого черновика
        return null;
      }
      if (isDraftExpired(resolved, resolved === cloudDraft)) {
        if (!localFailed) await WritingDraftService.deleteDraft(userId); // намеренно: удаление просроченного черновика
        return null;
      }
      if (resolved === cloudDraft && !localFailed) {
        // SF3-1: принятая копия — она же единственная отправка, о которой мы знаем.
        await WritingDraftService.saveToLocal({ ...cloudDraft, owner: userId, _cloudUpdatedAt: toTimestampMs(cloudDraft.updatedAt) ?? undefined, _cloudAckedHash: draftPayloadHash(cloudDraft), _cloudSentHashes: [draftPayloadHash(cloudDraft)] })
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

  /** 'written' — записано; другой итог мутатора — пропуск: черновик устарел
   *  (`'stale-epoch'`: эпоху подняли сохранение заметки, удаление или конец
   *  сессии), у записи нет владельца (`'no-owner'`) или он назван чужой
   *  (`'owner-mismatch'`). Пропуск — не запись, и «Сохранено» по нему показывать
   *  нельзя (N-33). */
  saveToLocal: async (draft: LocalDraft, generation?: number): Promise<ApplyWriteOutcome> => {
    if (!draft.userId) {
      return 'no-owner';
    }
    // DW4-2: единственный писатель строки — мутатор `applyWrite` (draftWriter).
    // Шаг 5: эпоху писатель либо называет явно, либо приносит в строке
    // (`buildLocalDraft`); фоново принятое из облака кэширование эпохи не имеет
    // и не сверяется.
    const epoch = generation ?? (typeof draft.epoch === 'number' ? draft.epoch : undefined);
    const basis: DraftWriteBasis = epoch !== undefined ? 'edit' : 'adopt-cloud';
    return applyWrite(draft as unknown as DraftRecord, basis, {
      uid: draft.userId,
      epoch,
    });
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
    // DW5-3.4: в облаке у аккаунта один ряд черновика, и запись с чужим `owner`
    // — это I3 уже в облачной половине. Локальную половину отсекает мутатор, здесь
    // та же сверка одной строкой. Строки до 0.11.5 владельца не несут — их это
    // вето не касается.
    if (typeof draft.owner === 'string' && draft.owner !== draft.userId) return false;
    if (!cloudSyncEnabled(draft.userId)) return false;
    if (!isProfileLoaded(draft.userId)) {
      return false;
    }
    // Шаг 5 DW-4: облачная половина сверяется по тому же правилу эпохи, что и
    // локальная (`draftWriter.isEpochStale`), и по той же отметке — названной
    // писателем или принесённой строкой. Признак «ничего не изменилось»
    // (`_lastCloudSignature`) и 60-секундный коридор SF-2 остаются как есть:
    // это тормоз облачной квоты, а не защита порядка (§4.4).
    const epoch = generation ?? (typeof draft.epoch === 'number' ? draft.epoch : undefined);
    if (isEpochStale(draft.userId, epoch)) {
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
    if (isEpochStale(draft.userId, epoch)) {
      return false;
    }
    const clean = Object.fromEntries(
      Object.entries(encrypted).filter(([k, v]) => v !== undefined && (k in DRAFT_CLOUD_FIELDS))
    );
    try {
      if (isEpochStale(draft.userId, epoch)) {
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
      // Облако держит одну строку черновика: принятая запись нового черновика
      // заменила удалённый — досылать удаление больше нечего (иначе оно стёрло бы
      // этот новый черновик при следующей загрузке; приёмка 0.10.6).
      clearPendingCloudDelete(draft.userId);
      return true;
    } catch (e) {
      if (isEpochStale(draft.userId, epoch)) {
        return false;
      }
      reportError(e, { action: 'saveDraftToCloud', userId: draft.userId });
      throw e;
    }
  },

  /** localOk — локальный черновик удалён (или его не было); false — он может
   *  всплыть «несохранённым». AP2-4: cloudOk — облачная строка снесена; если
   *  нет, удаление досылается при следующей загрузке. */
  deleteDraft: async (userId: string): Promise<{ localOk: boolean; cloudOk: boolean }> => {
    if (!userId) return { localOk: true, cloudOk: true };
    const { localOk } = await deleteDraftLocalPart(userId);
    const { cloudOk } = await deleteDraftCloudPart(userId);
    return { localOk, cloudOk };
  },

  /** RA1-2: локальная половина удаления — то, без чего «сохранено» неправда.
   *  Облачную строку сносит deleteDraftCloud, и её можно не ждать: надгробие
   *  (пишется здесь) снесёт облачную копию при следующей загрузке. */
  deleteDraftLocal: async (userId: string): Promise<{ localOk: boolean }> => {
    if (!userId) return { localOk: true };
    return deleteDraftLocalPart(userId);
  },

  deleteDraftCloud: async (userId: string): Promise<{ cloudOk: boolean }> => {
    if (!userId) return { cloudOk: true };
    return deleteDraftCloudPart(userId);
  }
};
