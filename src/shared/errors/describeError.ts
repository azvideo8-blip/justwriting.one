/**
 * Описание ошибки для человека — по-русски. Исходный английский текст остаётся
 * разработчику в контексте записи (reportError кладёт его в `raw`).
 *
 * Правила по порядку, первое совпавшее выигрывает. Смотрим на текст и на поля
 * причины в контексте: «Sync failed» сам по себе ничего не говорит, а причина
 * лежит в `reason` / `error` — например, запертый сейф. Весь контекст не берём:
 * числа вроде размера в байтах совпали бы с кодами ответа.
 */
const RULES: ReadonlyArray<[RegExp, { ru: string; en: string }]> = [
  [/LOCK_HELD/, {
    ru: 'Эта заметка сейчас синхронизируется в другой вкладке — повторим позже.',
    en: 'This note is currently syncing in another tab — will retry later.',
  }],
  [/ENCRYPT_REQUIRED|\bLOCKED\b|session key not available|[Vv]ault is locked/, {
    ru: 'Возможно, сейф заблокирован: зашифрованное нельзя ни отправить, ни прочитать. Откройте сейф в настройках — синхронизация продолжится сама.',
    en: 'Vault may be locked: encrypted data cannot be sent or read. Unlock vault in settings — sync will resume automatically.',
  }],
  [/DECRYPTION_ERROR|DecryptionError|OperationError/, {
    ru: 'Не удалось расшифровать запись — возможно, она зашифрована другим ключом сейфа.',
    en: 'Failed to decrypt record — it may be encrypted with a different vault key.',
  }],
  [/QuotaExceeded|quota exceeded/i, {
    ru: 'На устройстве закончилось место для данных сайта. Написанное на экране цело — освободите место и сохраните снова.',
    en: 'Device is out of storage for site data. Your onscreen text is intact — free up space and save again.',
  }],
  [/42501|row-level security|permission denied|JWT|invalid.*token|\b40[13]\b/i, {
    ru: 'Сервер отказал в доступе — возможно, сессия устарела. Если повторяется, выйдите и войдите снова.',
    en: 'Server denied access — session may have expired. If this persists, sign out and sign in again.',
  }],
  [/\b429\b|Too many requests/i, {
    ru: 'Слишком много запросов — сервер попросил подождать. Повторим позже.',
    en: 'Too many requests — server asked to wait. Will retry later.',
  }],
  [/Failed to fetch|Load failed|NetworkError|network|ECONNRESET|offline/i, {
    ru: 'Нет связи с сервером. Данные на устройстве, отправим, когда связь появится.',
    en: 'No connection to server. Data remains on device, will send when connection returns.',
  }],
  [/time(d)? ?out/i, {
    ru: 'Сервер не ответил вовремя. Повторим позже.',
    en: 'Server did not respond in time. Will retry later.',
  }],
  [/\b5\d\d\b|Internal Server Error/i, {
    ru: 'Ошибка на сервере. Данные на устройстве, повторим позже.',
    en: 'Server error. Data remains on device, will retry later.',
  }],
  [/AbortError|aborted/i, {
    ru: 'Запрос прерван.',
    en: 'Request aborted.',
  }],
  [/SESSION_TERMINATED/, {
    ru: 'Сессия завершилась неожиданно — вы вышли из аккаунта.',
    en: 'Session terminated unexpectedly — you signed out of the account.',
  }],
  [/quarantined/i, {
    ru: 'Заметка несколько раз не смогла синхронизироваться и отложена. Повторить можно в диагностике.',
    en: 'Note failed to sync multiple times and has been quarantined. You can retry in diagnostics.',
  }],
  [/sync|cloud save|cloud/i, {
    ru: 'Не удалось синхронизировать с облаком. Данные на устройстве, повторим позже.',
    en: 'Failed to sync with cloud. Data remains on device, will retry later.',
  }],
  [/IndexedDB|VersionError|InvalidStateError|TransactionInactive|idb/i, {
    ru: 'Сбой локальной базы браузера. Если повторяется, перезагрузите страницу.',
    en: 'Browser local database error. If this persists, reload the page.',
  }],
];

const FALLBACK = {
  ru: 'Техническая ошибка — подробности для разработчика ниже.',
  en: 'Technical error — details for developer below.',
};
const CYRILLIC = /[А-Яа-яЁё]/;

/** Описание ошибки на выбранном языке; null — текст уже переведён, переводить нечего. */
export function describeError(raw: string, context?: Record<string, unknown>, lang: 'ru' | 'en' = 'ru'): string | null {
  if (lang === 'ru' && CYRILLIC.test(raw)) return null;
  let haystack = raw;
  for (const k of ['reason', 'error', 'code', 'status']) {
    const v = context?.[k];
    if (typeof v === 'string' || typeof v === 'number') haystack += ` ${v}`;
  }
  for (const [re, text] of RULES) {
    if (re.test(haystack)) return text[lang] || text.ru;
  }
  return FALLBACK[lang] || FALLBACK.ru;
}
