// S-49: разбор облачных строк одной записи local_store_records — общий для
// восстановления (AIRestoreService) и выгрузки диалога (LocalStoreSyncService).
// Прежде выгрузка читала только строку `key`, а страницы `key#N` не видела:
// постраничная облачная копия читалась как «строки нет», устройство вставляло
// свою копию и сносило страницы другого.
//
// Форматы ключей:
//   `key`            — запись целиком, либо (S-49) манифест постраничной записи
//                      `{ manifest: true, updatedAt, totalPages }`;
//   `key#<stamp>#<N>` — страница N версии `stamp` (= updatedAt записи), S-49;
//   `key#<N>`         — страница N без версии в ключе (все хранилища до S-49 и
//                      все, кроме диалогов, после).

export interface CloudRow {
  key: string;
  payload: Record<string, unknown>;
  checksum?: string | undefined;
}

export interface ParsedKey {
  baseKey: string;
  /** null — не страница. */
  pageIndex: number | null;
  /** Версия из ключа (`key#<stamp>#<N>`); null у страниц старого формата. */
  stamp: number | null;
}

export function parseLocalStoreKey(key: string): ParsedKey {
  const versioned = /^(.+)#(\d+)#(\d+)$/.exec(key);
  if (versioned) return { baseKey: versioned[1]!, stamp: Number(versioned[2]), pageIndex: Number(versioned[3]) };
  const legacy = /^(.+)#(\d+)$/.exec(key);
  if (legacy) return { baseKey: legacy[1]!, stamp: null, pageIndex: Number(legacy[2]) };
  return { baseKey: key, stamp: null, pageIndex: null };
}

export interface Manifest { updatedAt: number; totalPages: number }

export function readManifest(payload: Record<string, unknown>): Manifest | null {
  if (payload.manifest !== true) return null;
  if (typeof payload.updatedAt !== 'number' || typeof payload.totalPages !== 'number' || payload.totalPages <= 0) return null;
  return { updatedAt: payload.updatedAt, totalPages: payload.totalPages };
}

export type CloudVersion =
  | { kind: 'single'; row: CloudRow }
  | { kind: 'pages'; pages: CloudRow[]; updatedAt: number }
  | { kind: 'refused'; reason: string };

/**
 * Какую версию записи читать из её облачных строк (`rows` — строка `key` и
 * все `key#…`). Манифест (S-49) указывает версию точно: берутся только
 * страницы с его `stamp`, и их должно быть ровно `totalPages` — страницы
 * других версий (проигравшей попытки, прежней длины) не смотрятся. Без
 * манифеста — как раньше: самая свежая ПОЛНАЯ версия по отметке в payload;
 * смесь версий или неполный набор — отказ, локальная копия остаётся. Строка
 * целиком рядом со страницами без манифеста: побеждает более свежая отметка
 * (запись, упавшая между страницами и строкой, оставляла обе).
 */
export function selectCloudVersion(rows: CloudRow[]): CloudVersion | null {
  let single: CloudRow | null = null;
  let manifest: Manifest | null = null;
  const pages: Array<{ row: CloudRow; pageIndex: number; stamp: number | null }> = [];
  for (const row of rows) {
    const parsed = parseLocalStoreKey(row.key);
    if (parsed.pageIndex === null) {
      manifest = readManifest(row.payload);
      if (!manifest) single = row;
      continue;
    }
    pages.push({ row, pageIndex: parsed.pageIndex, stamp: parsed.stamp });
  }

  if (manifest) {
    const m = manifest;
    const own = pages.filter(p => p.stamp === m.updatedAt);
    return assemble(own, m.updatedAt, m.totalPages);
  }
  if (pages.length === 0) return single ? { kind: 'single', row: single } : null;

  // Без манифеста: версии по отметке payload (как в AIRestoreService до S-49).
  const versions = new Map<string, typeof pages>();
  for (const p of pages) {
    const ts = p.row.payload.updatedAt;
    const total = p.row.payload.totalPages;
    const key = `${typeof ts === 'number' ? ts : 'x'}|${typeof total === 'number' ? total : 'x'}`;
    versions.set(key, [...(versions.get(key) ?? []), p]);
  }
  const newest = [...versions.values()]
    .filter(v => typeof v[0]!.row.payload.updatedAt === 'number' && typeof v[0]!.row.payload.totalPages === 'number')
    .sort((a, b) => (b[0]!.row.payload.updatedAt as number) - (a[0]!.row.payload.updatedAt as number))[0];
  if (!newest) {
    return single ? { kind: 'single', row: single } : { kind: 'refused', reason: 'no page carries updatedAt and totalPages' };
  }
  const newestAt = newest[0]!.row.payload.updatedAt as number;
  if (single && typeof single.payload.updatedAt === 'number' && single.payload.updatedAt >= newestAt) {
    return { kind: 'single', row: single };
  }
  return assemble(newest, newestAt, newest[0]!.row.payload.totalPages as number);
}

function assemble(
  pages: Array<{ row: CloudRow; pageIndex: number }>,
  updatedAt: number,
  totalPages: number,
): CloudVersion {
  const byIndex = new Map<number, CloudRow>();
  for (const p of pages) {
    if (byIndex.has(p.pageIndex)) return { kind: 'refused', reason: `duplicate page index ${p.pageIndex}` };
    byIndex.set(p.pageIndex, p.row);
  }
  const sorted: CloudRow[] = [];
  for (let i = 0; i < totalPages; i++) {
    const page = byIndex.get(i);
    if (!page) return { kind: 'refused', reason: `incomplete: page ${i} of ${totalPages} missing` };
    sorted.push(page);
  }
  if (byIndex.size !== totalPages) return { kind: 'refused', reason: `pages beyond ${totalPages}` };
  return { kind: 'pages', pages: sorted, updatedAt };
}
