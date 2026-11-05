// DW6-5.4: общий тормоз 429 жил внутри `CloudSyncService`, и пользоваться им
// мог только слой синка. Слою данных (`pageAll`) он тоже нужен — постраничный
// забор без него краснеет на первой же странице, — а импорт `CloudSyncService`
// из провайдера дал бы цикл (`CloudSyncService` → `DataProvider` → провайдер).
// Поэтому тормоз переехал сюда: он не зависит ни от чего, и звать его могут все.

/**
 * FD-2: `429` — не «сбой заметки», а «притормози».
 *
 * Распознавание — по ТЕКСТУ. Замер на стенде (supabase-js 2.118.0, nginx-подобный
 * 429 с телом text/html): в объекте ошибки есть ТОЛЬКО `message` с HTML-страницей;
 * при теле JSON — `error` + `message`. `status`, `statusCode` и `code` PostgREST-js
 * не отдаёт, когда тело не распознано как JSON-ошибка. Проверка по коду поэтому
 * молча не сработала бы на проде — но оставлена: harness отдаёт `code: '429'`, а
 * живой PostgREST мог бы начать отдавать статус.
 */
export function isRateLimitedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown };
  if (e.code === '429' || e.code === 429 || e.status === 429 || e.statusCode === 429) return true;
  const msg = String(e.message ?? '');
  // Ревью FD: голое «429» в тексте не признак — `DECRYPT_FAILED_LATEST … version 429`
  // повторялся бы шесть раз и тормозил все скачивания. Страница nginx несёт фразу.
  return /too many requests|rate limit/i.test(msg);
}

// Темп общий на процесс: одна отбитая заметка закрывает очередь для всех, а не
// только для себя, — иначе 5 воркеров `downloadLimit` продолжают долбить лимит.
// Значения — из тикета (2 → 4 → 8 → 16 с); наружу выставлены для тестов, чтобы
// юнит не спал минуту.
export const rateLimitTuning = { baseMs: 2_000, maxMs: 16_000, maxAttempts: 6 };

// Ревьюер 04.11: постраничный повтор (`pageAll`) вложен во внешний вокруг списка. Ошибка,
// на которой внутренний уже сдался, наружу идёт сразу: иначе 6×6 попыток с паузой
// до 16 с держали бы экран около десяти минут.
const exhausted = new WeakSet<object>();

let rateGateUntilMs = 0;
let ratePauseMs = rateLimitTuning.baseMs;
let lastLimitedAtMs = 0;

/** Пауза, которую все скачивания обязаны выдержать перед следующим запросом. */
async function waitRateGate(): Promise<void> {
  for (;;) {
    const wait = rateGateUntilMs - Date.now();
    if (wait <= 0) return;
    await new Promise(res => setTimeout(res, Math.min(wait, 250)));
  }
}

/** Закрыть очередь на текущую паузу и удвоить её (с потолком). */
function openRateGate(): void {
  lastLimitedAtMs = Date.now();
  rateGateUntilMs = lastLimitedAtMs + ratePauseMs;
  ratePauseMs = Math.min(ratePauseMs * 2, rateLimitTuning.maxMs);
}

/** Проход без единого 429 — темп можно вернуть к базовому. */
function resetRateGate(): void {
  // Дейлик 05.11 К-1: при 429 половина запросов проходит, и сброс на любой удаче не давал паузе
  // вырасти: шесть попыток кончались за секунды вместо минуты. Сброс — только после тишины дольше самой длинной паузы.
  if (Date.now() - lastLimitedAtMs < rateLimitTuning.maxMs * 2) return;
  ratePauseMs = rateLimitTuning.baseMs;
}

/**
 * Выполнить `fn`, а если сервер ответил 429 — подождать общий тормоз и повторить
 * ТО ТО ЖЕ самое. В ошибку значение выходит только после исчерпания повторов.
 */
export async function withRateLimitRetry<T>(fn: () => Promise<T>, attempts = rateLimitTuning.maxAttempts): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await waitRateGate();
    try {
      const res = await fn();
      resetRateGate();
      return res;
    } catch (e) {
      if (!isRateLimitedError(e) || exhausted.has(e as object)) throw e;
      openRateGate();
      if (attempt + 1 >= attempts) {
        exhausted.add(e as object);
        throw e;
      }
    }
  }
}
