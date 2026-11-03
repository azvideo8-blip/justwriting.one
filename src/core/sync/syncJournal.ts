import { getCurrentUser } from '../auth';

/**
 * S0-2 (F-3, R7F-020): механика журналов ИИ-синка — один ключ на учётку.
 *
 * Прежние пять журналов (`ai_sync_pending_upserts`, `ai_sync_pending_deletes`,
 * `ai_sync_dead_upserts`, `ai_sync_pending_analysis_deletes`,
 * `sync_pending_duration`) лежали на общих ключах браузера, а uid был только
 * внутри строк. Одна структурно битая строка чужой учётки делала весь журнал
 * нечитаемым — и выгрузка, и забор останавливались у ВСЕХ аккаунтов устройства.
 * Первым так же уже уехал `oversized` (R4-017, `oversizedKeyFor`).
 *
 * Разбор — толерантный по строкам, но не по целому журналу: нечитаемый JSON это
 * `corrupt`, недоступный storage — `unavailable`, а «прочитано и пусто» —
 * отдельный ответ. Сводить первое ко второму нельзя (A-5/R2-012, R3-012):
 * «не знаю, что висит» не равно «висеть нечему».
 *
 * Перенос старого общего ключа — при первом чтении ключа учётки; сам общий ключ
 * не удаляется один релиз. SF-8: флага «перенесено» в коде больше нет — он
 * писался в трёх местах и не читался ни в одном, а отчёт пакета описывал откат
 * как «снять флаг». Откат пакета — возврат кода, и старый бандл читает общий
 * ключ, строки которого с момента переноса устарели: длительности считаются
 * повторно, завершённые удаления уходят ещё раз, правки выгружаются слепо. Это и
 * есть честная цена отката, она не управляется флагом.
 */

export type JournalRead<T> =
  | { rows: T[]; dropped: number }
  | { corrupt: true }
  | { unavailable: true };

/**
 * Пять журналов, переехавших на ключ учётки (S0-2). Названы здесь списком,
 * потому что этот модуль и есть их писатель: гейт инвентаря (LS-8) ищет
 * объявленный шаблон в файле, который реально его пишет.
 */
// Список нужен двояко: гейт инвентаря LS-8 ищет литерал имени журнала в файле,
// который его пишет, а гейт S0-6 сверяет с ним объявленные ключи учётки.
export const JOURNAL_BASE_NAMES = [
  'sync_pending_duration',
  'ai_sync_pending_deletes',
  'ai_sync_pending_upserts',
  'ai_sync_dead_upserts',
  'ai_sync_pending_analysis_deletes',
  // S2-7: прибавки счётчиков в пути (`pendingDelta.ts`) — сразу на ключе учётки.
  'sync_pending_delta',
] as const;

/** Ключ журнала для учётки. Без uid — общий ключ гостя (как до правки). */
export function journalKeyFor(base: string, uid?: string | null): string {
  // Конкатенация, а не шаблон: ключ собирается из параметра, и гейт инвентаря
  // (R7F-021) не обязан угадывать его по форме литерала — список семейств даёт
  // accountScopedKeys, где эти ключи объявлены явно.
  return uid ? base + ':' + uid : base;
}


function getItem(key: string): string | null | undefined {
  try {
    return localStorage.getItem(key);
  } catch {
    return undefined;
  }
}

function setItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function parseJournalRows<T>(raw: string, validate: (v: unknown) => v is T): { rows: T[]; dropped: number } | { corrupt: true } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { corrupt: true };
  }
  if (!Array.isArray(parsed)) return { corrupt: true };
  const rows: T[] = [];
  let dropped = 0;
  for (const item of parsed) {
    if (validate(item)) rows.push(item);
    else dropped++;
  }
  return { rows, dropped };
}

/** Массив из JSON-нагрузки журнала; `null` — текст не разбирается вовсе. */
function parseJournalArray(raw: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Разбор общего ключа на учётку: берутся только строки этой учётки, чужие
 * молча пропускаются (их перенесёт их аккаунт — флаг переноса на учётку).
 * `dropped` считает только СТРОКИ СВОЕЙ учётки без нужных полей: чужая битая
 * строка не имеет права обнулять наш журнал — это и был F-3.
 * Общий ключ остаётся на месте один релиз; нечитаемый общий журнал — `corrupt`
 * БЕЗ флага, чтобы починка повторила перенос, а не потеряла его.
 */
function migrateSharedJournal<T>(base: string, uid: string, validate: (v: unknown) => v is T): JournalRead<T> {
  const sharedRaw = getItem(base);
  if (sharedRaw === undefined) return { unavailable: true };
  if (sharedRaw === null) return { rows: [], dropped: 0 };
  const items = parseJournalArray(sharedRaw);
  if (items === null) return { corrupt: true };
  const mine: T[] = [];
  let dropped = 0;
  for (const item of items) {
    // Чужие строки пропускаются молча: их перенесёт их учётка, а общий ключ на месте.
    if ((item as { uid?: unknown } | null)?.uid !== uid) continue;
    if (validate(item)) mine.push(item);
    else dropped++;
  }
  if (!setItem(journalKeyFor(base, uid), JSON.stringify(mine))) return { unavailable: true };
  return { rows: mine, dropped };
}

/** Прочитать журнал учётки; при отсутствии ключа — перенести из общего. */
export function readJournal<T>(
  base: string,
  uid: string | null | undefined,
  validate: (v: unknown) => v is T,
): JournalRead<T> {
  if (!uid) {
    const raw = getItem(base);
    if (raw === undefined) return { unavailable: true };
    if (raw === null) return { rows: [], dropped: 0 };
    return parseJournalRows(raw, validate);
  }
  const raw = getItem(journalKeyFor(base, uid));
  if (raw === undefined) return { unavailable: true };
  if (raw === null) return migrateSharedJournal(base, uid, validate);
  return parseJournalRows(raw, validate);
}

/** Перезаписать журнал учётки. false — не записалось: вызывающий обязан сказать об этом. */
export function writeJournal<T>(base: string, uid: string | null | undefined, rows: T[]): boolean {
  return setItem(journalKeyFor(base, uid), JSON.stringify(rows));
}

/**
 * Сырой текст журнала для починки: сначала ключ учётки, при его отсутствии —
 * общий ключ, из которого шёл перенос (именно он и бывает битым). `none` —
 * журналов нет вовсе; это «прочитано и пусто», а не «не прочитано».
 */
export function readJournalRawForHealing(
  base: string,
  uid: string | null | undefined,
): { raw: string; fromShared: boolean } | { none: true } | { unavailable: true } {
  if (uid) {
    const own = getItem(journalKeyFor(base, uid));
    if (own === undefined) return { unavailable: true };
    if (own !== null) return { raw: own, fromShared: false };
  }
  const shared = getItem(base);
  if (shared === undefined) return { unavailable: true };
  if (shared === null) return { none: true };
  return { raw: shared, fromShared: true };
}

/** Текущая учётка — для журналов, где uid не передают аргументом. */
export function currentJournalUid(): string | null {
  const uid = getCurrentUser()?.uid;
  return uid && uid !== 'guest' && !uid.startsWith('guest_') ? uid : null;
}
