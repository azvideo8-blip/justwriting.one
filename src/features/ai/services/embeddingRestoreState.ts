/**
 * П-6 (замер 08.10.2026): состояние автоматической догрузки векторов из облака.
 *
 * На новом или очищенном устройстве векторов нет, `findStaleDocuments` считает
 * устаревшим весь архив, и `indexPending` пересчитывает его через ИИ — хотя все
 * векторы уже лежат в облаке и достаются дешёвым чтением. Флаг-кнопка в
 * диагностике была введена в июле из-за лимита чтений облачной базы (тогда скачать
 * было дороже дня, а пересчитать — бесплатно); с тех пор цена перевернулась, но
 * предохранители июля остаются.
 *
 * Флаги на аккаунт, все в localStorage:
 *  - `ai_embed_restore_requested_*` — кнопка, теперь значит «форсировать»:
 *    запускает догрузку независимо от покрытия и от того, что проход уже
 *    завершался;
 *  - `ai_embed_restore_started_*` — догрузка хотя бы раз началась: только с этим
 *    признаком `indexPending` ждёт и не пересчитывает заметки без локального
 *    вектора (иначе обычное устройство с целым индексом перестало бы индексировать
 *    новые заметки). Значение — метка времени первого старта (В-1): по ней
 *    догрузка перестаёт быть «в пути» через сутки;
 *  - `ai_embed_restore_done_*` — скачивать нечего. После него автоматический
 *    проход не повторяется. Снимается явно (просьба пользователя) или когда
 *    локальных векторов нет вовсе — это признак свежего устройства, и начинать
 *    догрузку нужно заново;
 *  - `ai_embed_restore_stall_*` — сколько проходов подряд курсор не сдвинулся
 *    (В-1). Три — догрузка встала, ждать нельзя.
 */

const REQUESTED_PREFIX = 'ai_embed_restore_requested_';
const CURSOR_PREFIX = 'ai_embed_restore_cursor_';
const LEGACY_REQUESTED = 'ai_embed_restore_requested';
const LEGACY_CURSOR = 'ai_embed_restore_cursor';
const STARTED_PREFIX = 'ai_embed_restore_started_';
const DONE_PREFIX = 'ai_embed_restore_done_';
const STALL_PREFIX = 'ai_embed_restore_stall_';

/** В-1: догрузка не может «быть в пути» дольше суток. */
const STARTED_STALE_MS = 24 * 60 * 60_000;
/** В-1: три прохода без продвижения курсора — догрузка стоит. */
const STALL_LIMIT = 3;
// Значение флага старта — метка времени. Всё, что меньше этой планки, временем
// быть не может (в нём флаг ставила прошлая сборка), и при первом же проходе
// получает настоящее время.
const EPOCH_FLOOR = Date.UTC(2020, 0, 1);

function read(key: string): boolean {
  try { return localStorage.getItem(key) !== null; } catch { return false; }
}

function peek(key: string): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}

function write(key: string, value = '1'): void {
  // намеренно: хранилище недоступно — флаг не ставится. Цена молчания — повторная
  // догрузка на следующем проходе, а не «сохранено» там, где не сохранилось.
  try { localStorage.setItem(key, value); } catch { /* намеренно: см. комментарий выше */ }
}

function drop(key: string): void {
  // намеренно: хранилище недоступно — флаг не снят. Цена — лишняя проверка флага
  // на следующем проходе, а не обещание, которое нельзя выполнить.
  try { localStorage.removeItem(key); } catch { /* намеренно: см. комментарий выше */ }
}

/**
 * Флаг кнопки «догрузить семантический индекс» = форсировать проход. Запрос
 * снимает «догрузка завершена»: повторная просьба после исчерпанного курсора
 * обязана качать заново, а не молчать.
 */
export function requestEmbeddingRestore(userId: string): boolean {
  if (!userId) return false;
  // NB-16: флаг запроса — единственная запись, отказ которой обязан видеть
  // вызывающий: кнопка не обещает догрузку, которой не будет. Внутренние метки
  // (старт/курсор/готово) пишет fire-and-forget write() — их отказ не обещание.
  let ok: boolean;
  try { localStorage.setItem(`${REQUESTED_PREFIX}${userId}`, '1'); ok = true; } catch { ok = false; }
  drop(LEGACY_REQUESTED);
  clearEmbeddingRestoreDone(userId);
  clearEmbeddingRestoreStarted(userId);
  return ok;
}

export function isEmbeddingRestoreRequested(userId: string): boolean {
  if (!userId) return false;
  drop(LEGACY_REQUESTED);          // миграция в одну строку: ключ по аккаунту (LS-4)
  return read(`${REQUESTED_PREFIX}${userId}`);
}

/** Кнопка отжала свою работу — курсор и флаги догружения сбрасывает вызывающий. */
export function clearEmbeddingRestoreRequest(userId: string): void {
  if (!userId) return;
  drop(`${REQUESTED_PREFIX}${userId}`);
  drop(LEGACY_REQUESTED);
}

/**
 * Догрузка начиналась хоть раз — с этого признака `indexPending` ждёт облако.
 * Метка ставится один раз и не обновляется каждым проходом: сутки В-1 считаются
 * с первого старта, иначе «в пути» было бы вечно, пока открыто приложение.
 */
export function markEmbeddingRestoreStarted(userId: string): void {
  if (!userId) return;
  if (startedAtMs(userId) >= EPOCH_FLOOR) return;
  write(`${STARTED_PREFIX}${userId}`, String(Date.now()));
}

export function isEmbeddingRestoreStarted(userId: string): boolean {
  return !!userId && read(`${STARTED_PREFIX}${userId}`);
}

export function clearEmbeddingRestoreStarted(userId: string): void {
  if (!userId) return;
  drop(`${STARTED_PREFIX}${userId}`);
  clearEmbeddingRestoreStall(userId);
}

function startedAtMs(userId: string): number {
  const t = Number(peek(`${STARTED_PREFIX}${userId}`));
  return Number.isFinite(t) ? t : 0;
}

/**
 * В-1: догрузка «в пути» дольше суток. Такая метка значит, что облако не отдаёт
 * остальное (или устройство не включали), а `indexPending` всё это время не
 * трогает заметки без вектора. Ждать дальше нельзя: их надо пересчитать.
 */
export function isEmbeddingRestoreStuck(userId: string, nowMs = Date.now()): boolean {
  if (!userId) return false;
  if (!read(`${STARTED_PREFIX}${userId}`)) return false;
  const t = startedAtMs(userId);
  if (t < EPOCH_FLOOR) return true;   // метки без времени не бывает: считаем застарелой
  return nowMs - t >= STARTED_STALE_MS;
}

/**
 * В-1: сколько проходов подряд курсор не сдвинулся. Продвижение обнуляет
 * счётчик; три без движения — догрузка стоит на одной странице, и вызывающий
 * получает сигнал её закрыть. Проход, который упал на чтении облака, сюда не
 * попадает: он не дошёл до записи счётчика, сеть — не повод пересчитывать архив
 * через ИИ.
 */
export function noteEmbeddingRestoreProgress(userId: string, advanced: boolean): boolean {
  if (!userId) return false;
  const key = `${STALL_PREFIX}${userId}`;
  if (advanced) {
    drop(key);
    return false;
  }
  const stalled = Number(peek(key)) + 1;
  write(key, String(stalled));
  return stalled >= STALL_LIMIT;
}

export function clearEmbeddingRestoreStall(userId: string): void {
  if (!userId) return;
  drop(`${STALL_PREFIX}${userId}`);
}

/** Курсор исчерпан: автоматический проход больше не начинается. */
export function markEmbeddingRestoreDone(userId: string): void {
  if (!userId) return;
  write(`${DONE_PREFIX}${userId}`);
}

export function isEmbeddingRestoreDone(userId: string): boolean {
  return !!userId && read(`${DONE_PREFIX}${userId}`);
}

export function clearEmbeddingRestoreDone(userId: string): void {
  if (!userId) return;
  drop(`${DONE_PREFIX}${userId}`);
}

/**
 * Догрузка в пути: начиналась и ещё не дошла до конца. Пока она в пути,
 * `indexPending` не пересчитывает заметки без локального вектора — см. П-6.
 * В-1: просроченная (сутки) догрузка в пути больше не считается — иначе
 * `indexPending` ждал бы её вечно.
 */
export function isEmbeddingDownloadPending(userId: string | undefined, nowMs = Date.now()): boolean {
  if (!userId) return false;
  return isEmbeddingRestoreStarted(userId)
    && !isEmbeddingRestoreDone(userId)
    && !isEmbeddingRestoreStuck(userId, nowMs);
}

/** Курсор: на какой строке облачного списка остановился прошлый проход. Живёт
 *  между проходами, чтобы ограниченный потолком забор не начинал каждый день с
 *  начала и не платил за уже прочитанные страницы. Прерывание курсор не трогает.
 */
export function getEmbeddingRestoreCursor(userId: string): string {
  if (!userId) return '';
  try {
    localStorage.removeItem(LEGACY_CURSOR);
    return localStorage.getItem(`${CURSOR_PREFIX}${userId}`) ?? '';
  } catch { return ''; }
}

export function setEmbeddingRestoreCursor(userId: string, id: string): void {
  if (!userId) return;
  // намеренно: курсор не записан — следующий проход начнёт с начала и
  // заплатит за уже прочитанные страницы. Хуже молчания тут ничего нет: сейф без
  // localStorage не пишет вообще никаких флагов.
  try { localStorage.setItem(`${CURSOR_PREFIX}${userId}`, id); } catch { /* намеренно: см. комментарий выше */ }
}

export function clearEmbeddingRestoreCursor(userId: string): void {
  if (!userId) return;
  drop(LEGACY_CURSOR);
  drop(`${CURSOR_PREFIX}${userId}`);
}
