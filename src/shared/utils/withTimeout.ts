/** Ошибка клиентского таймаута. Отдельный тип, потому что «мы не дождались» — не
 *  то же самое, что «сервер сломался», а по голому Error(message) их не различить. */
export class TimeoutError extends Error {
  readonly isTimeout = true;
  constructor(message = 'Timeout') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Rejects with TimeoutError(message) if the promise doesn't settle within ms.
 * Always clears the timer once the race settles, so no timeout fires late.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = 'Timeout'): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimeoutError(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
