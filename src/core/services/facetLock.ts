// Сериализация записи в aiProfileFacets.
//
// Лок живёт отдельным модулем в core/services без зависимостей, чтобы его могли
// безопасно импортировать как core (LocalDocumentService), так и features/ai.
let facetWriteLock: Promise<unknown> = Promise.resolve();

export function withFacetLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = facetWriteLock.then(fn);
  facetWriteLock = result.then(() => undefined, () => undefined);
  return result;
}
