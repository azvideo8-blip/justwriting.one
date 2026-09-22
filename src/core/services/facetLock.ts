import type { IDBPTransaction } from 'idb';
import { getLocalDb, type AIProfileFacet, type JustWritingDB } from '../storage/localDb';

type AppDb = Awaited<ReturnType<typeof getLocalDb>>;

// Сериализация записи в aiProfileFacets.
//
// Лок живёт отдельным модулем в core/services, чтобы его могли
// безопасно импортировать как core (LocalDocumentService), так и features/ai.
let facetWriteLock: Promise<unknown> = Promise.resolve();

export function withFacetLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = facetWriteLock.then(fn);
  facetWriteLock = result.then(() => undefined, () => undefined);
  return result;
}

export interface FacetStoreWriter {
  put(facet: AIProfileFacet): Promise<string>;
  clear(): Promise<void>;
  delete(id: string): Promise<void>;
  getAll(): Promise<AIProfileFacet[]>;
  get(id: string): Promise<AIProfileFacet | undefined>;
  transaction(mode?: 'readwrite'): IDBPTransaction<JustWritingDB, ['aiProfileFacets'], 'readwrite'>;
  readonly db: AppDb;
}

export async function writeFacetStore<T>(
  fn: (store: FacetStoreWriter, db: AppDb) => Promise<T>,
): Promise<T> {
  return withFacetLock(async () => {
    const db = await getLocalDb();
    const store: FacetStoreWriter = {
      put: (facet) => db.put('aiProfileFacets', facet),
      clear: () => db.clear('aiProfileFacets'),
      delete: (id) => db.delete('aiProfileFacets', id),
      getAll: () => db.getAll('aiProfileFacets'),
      get: (id) => db.get('aiProfileFacets', id),
      transaction: (mode = 'readwrite') => db.transaction('aiProfileFacets', mode),
      db,
    };
    return fn(store, db);
  });
}
