export const PAGE_SIZE = 1000;

export interface PageQueryResult<T> {
  data: T[] | null;
  error: unknown;
}

export type PageQueryBuilder<T> = (
  from: number,
  to: number,
) => PromiseLike<PageQueryResult<T>>;

/**
 * DUP-5: Canonical PostgREST pagination loop.
 * Any bulk read query against tables that grow per note or version must be paginated
 * in batches of PAGE_SIZE (1000) to prevent silent truncation by PostgREST.
 */
export async function pageAll<T>(
  buildQuery: PageQueryBuilder<T>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  let from = 0;
  const allRows: T[] = [];
  while (true) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error != null) throw error;
    if (data === null || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}
