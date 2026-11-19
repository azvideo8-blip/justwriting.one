/**
 * Состояние асинхронного чтения — контракт хука, один на все экраны.
 *
 * Пять состояний, и у каждого только свои поля:
 *  - `loading` — читаем; `stale` — прошлый успешный результат, если экран держит его;
 *  - `error`   — не прочиталось; `retry` обязателен: ошибки без выхода тип не допускает;
 *  - `empty`   — прочитано целиком, и там ничего нет;
 *  - `partial` — локальное прочиталось, облако нет (`cloudLoadFailed`): данные
 *                есть, но это не ошибка и не «пусто», даже если данных ноль;
 *  - `data`    — прочитано целиком.
 *
 * Данные лежат только в `data` / `partial` (и в `stale`), поэтому экран не
 * может нарисовать «пусто» или нули, выбросив ошибку при деструктуризации:
 * у `error` и `loading` просто нет поля, по которому считать длину.
 */
export type LoadState<T> =
  | { status: 'loading'; stale: T | undefined }
  | { status: 'error'; retry: () => void; stale: T | undefined }
  | { status: 'empty' }
  | { status: 'partial'; data: T; retry: () => void }
  | { status: 'data'; data: T };

export const loadState = {
  loading: <T>(stale?: T): LoadState<T> => ({ status: 'loading', stale }),
  error: <T>(retry: () => void, stale?: T): LoadState<T> => ({ status: 'error', retry, stale }),
  /**
   * Итог удавшегося чтения. Единственное место, где рождается `empty`:
   * только когда облако прочиталось (`cloudFailed === null`) и данных нет.
   * `cloudFailed` — `null` либо «облако не прочиталось» с обязательным повтором.
   */
  settled: <T>(data: T, isEmpty: (data: T) => boolean, cloudFailed: { retry: () => void } | null = null): LoadState<T> => {
    if (cloudFailed) return { status: 'partial', data, retry: cloudFailed.retry };
    return isEmpty(data) ? { status: 'empty' } : { status: 'data', data };
  },
};

/** Последние известные данные: свежие или прошлые. `undefined` — нет ни тех, ни других. */
export function knownData<T>(state: LoadState<T>): T | undefined {
  if (state.status === 'data' || state.status === 'partial') return state.data;
  if (state.status === 'empty') return undefined;
  return state.stale;
}

/**
 * Срез данных (вкладка, фильтр поиска) без потери состояния. Срез целиком
 * прочитанных данных может оказаться пустым — тогда это `empty`; срез
 * частично прочитанных остаётся `partial`.
 */
export function mapLoadState<T, U>(state: LoadState<T>, fn: (data: T) => U, isEmpty: (data: U) => boolean): LoadState<U> {
  switch (state.status) {
    case 'empty': return state;
    case 'data': return loadState.settled(fn(state.data), isEmpty);
    case 'partial': return { status: 'partial', data: fn(state.data), retry: state.retry };
    case 'loading': return { status: 'loading', stale: state.stale === undefined ? undefined : fn(state.stale) };
    case 'error': return { status: 'error', retry: state.retry, stale: state.stale === undefined ? undefined : fn(state.stale) };
  }
}

/**
 * Переходник для хуков, которые ещё отдают `loading` / `error` / частичный
 * отказ отдельными полями. Только на время перевода: место, где флаги можно
 * перепутать, одно и под тестом. `stale` — уже прочитанные непустые данные.
 */
export function loadStateFromFlags<T extends readonly unknown[]>(
  flags: { loading: boolean; failed: boolean; partial: boolean; retry: () => void },
  data: T,
): LoadState<T> {
  const stale = data.length > 0 ? data : undefined;
  if (flags.failed) return { status: 'error', retry: flags.retry, stale };
  if (flags.loading) return { status: 'loading', stale };
  return loadState.settled(data, d => d.length === 0, flags.partial ? { retry: flags.retry } : null);
}
