/**
 * Описание ошибки для человека — по-русски. Исходный английский текст остаётся
 * разработчику в контексте записи (reportError кладёт его в `raw`).
 *
 * Правила по порядку, первое совпавшее выигрывает. Смотрим на текст и на поля
 * причины в контексте: «Sync failed» сам по себе ничего не говорит, а причина
 * лежит в `reason` / `error` — например, запертый сейф. Весь контекст не берём:
 * числа вроде размера в байтах совпали бы с кодами ответа.
 */
const RULES: ReadonlyArray<[RegExp, string]> = [
  [/LOCK_HELD/,
    'Эта заметка сейчас синхронизируется в другой вкладке — повторим позже.'],
  [/ENCRYPT_REQUIRED|\bLOCKED\b|session key not available|[Vv]ault is locked/,
    'Возможно, сейф заблокирован: зашифрованное нельзя ни отправить, ни прочитать. Откройте сейф в настройках — синхронизация продолжится сама.'],
  [/DECRYPTION_ERROR|DecryptionError|OperationError/,
    'Не удалось расшифровать запись — возможно, она зашифрована другим ключом сейфа.'],
  [/QuotaExceeded|quota exceeded/i,
    'На устройстве закончилось место для данных сайта. Написанное на экране цело — освободите место и сохраните снова.'],
  [/42501|row-level security|permission denied|JWT|invalid.*token|\b40[13]\b/i,
    'Сервер отказал в доступе — возможно, сессия устарела. Если повторяется, выйдите и войдите снова.'],
  [/\b429\b|Too many requests/i,
    'Слишком много запросов — сервер попросил подождать. Повторим позже.'],
  [/Failed to fetch|Load failed|NetworkError|network|ECONNRESET|offline/i,
    'Нет связи с сервером. Данные на устройстве, отправим, когда связь появится.'],
  [/time(d)? ?out/i,
    'Сервер не ответил вовремя. Повторим позже.'],
  [/\b5\d\d\b|Internal Server Error/i,
    'Ошибка на сервере. Данные на устройстве, повторим позже.'],
  [/AbortError|aborted/i,
    'Запрос прерван.'],
  [/SESSION_TERMINATED/,
    'Сессия завершилась неожиданно — вы вышли из аккаунта.'],
  [/quarantined/i,
    'Заметка несколько раз не смогла синхронизироваться и отложена. Повторить можно в диагностике.'],
  [/sync|cloud save|cloud/i,
    'Не удалось синхронизировать с облаком. Данные на устройстве, повторим позже.'],
  [/IndexedDB|VersionError|InvalidStateError|TransactionInactive|idb/i,
    'Сбой локальной базы браузера. Если повторяется, перезагрузите страницу.'],
];

const FALLBACK = 'Техническая ошибка — подробности для разработчика ниже.';
const CYRILLIC = /[А-Яа-яЁё]/;

/** Русское описание; null — текст уже по-русски, переводить нечего. */
export function describeError(raw: string, context?: Record<string, unknown>): string | null {
  if (CYRILLIC.test(raw)) return null;
  let haystack = raw;
  for (const k of ['reason', 'error', 'code', 'status']) {
    const v = context?.[k];
    if (typeof v === 'string' || typeof v === 'number') haystack += ` ${v}`;
  }
  for (const [re, text] of RULES) if (re.test(haystack)) return text;
  return FALLBACK;
}
