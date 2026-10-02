// S-49: разбор облачных строк одной записи local_store_records — общий для
// восстановления (AIRestoreService) и выгрузки диалога (LocalStoreSyncService).
// Прежде выгрузка читала только строку `key`, а страницы `key#N` не видела:
// постраничная облачная копия читалась как «строки нет», устройство вставляло
// свою копию и сносило страницы другого.
//
// Форматы ключей:
//   `key`            — запись целиком, либо (S-49) манифест постраничной записи
//                      `{ manifest: true, updatedAt, totalPages }`;
//   `key#<stamp>#<nonce>#<N>` — страница N попытки `nonce` версии `stamp`, M-2:
//                      одна попытка выгрузки = свой `nonce`, поэтому страницы
//                      неудавшейся попытки не могут collide со страницами победителя;
//   `key#<stamp>#<N>` — страница N версии `stamp` (= updatedAt записи), S-49;
//   `key#<N>`         — страница N без версии в ключе (все хранилища до S-49 и
//                      все, кроме диалогов, после).

import { randomUUID } from '../storage/localDb';

/** Метка попытки выгрузки (M-2): случайные 8 hex-символов, своя на каждую попытку. */
export function newPageNonce(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

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
  /** Метка попытки (M-2, `key#<stamp>#<nonce>#<N>`); null у страниц прежних форматов. */
  nonce: string | null;
}

export function parseLocalStoreKey(key: string): ParsedKey {
  const nonced = /^(.+)#(\d+)#([0-9a-z]{6,})#(\d+)$/.exec(key);
  if (nonced) return { baseKey: nonced[1]!, stamp: Number(nonced[2]), nonce: nonced[3]!, pageIndex: Number(nonced[4]) };
  const versioned = /^(.+)#(\d+)#(\d+)$/.exec(key);
  if (versioned) return { baseKey: versioned[1]!, stamp: Number(versioned[2]), nonce: null, pageIndex: Number(versioned[3]) };
  const legacy = /^(.+)#(\d+)$/.exec(key);
  if (legacy) return { baseKey: legacy[1]!, stamp: null, nonce: null, pageIndex: Number(legacy[2]) };
  return { baseKey: key, stamp: null, nonce: null, pageIndex: null };
}

/** Ключ страницы попытки (M-2): метка стоит ПЕРЕД номером страницы. */
export function pageKeyFor(baseKey: string, stamp: number, nonce: string, pageIndex: number): string {
  return `${baseKey}#${stamp}#${nonce}#${pageIndex}`;
}

/** Префикс всех страниц одной попытки — им чистит свои осколки проигравший. */
export function attemptPrefix(baseKey: string, stamp: number, nonce: string): string {
  return `${baseKey}#${stamp}#${nonce}`;
}

export interface Manifest { updatedAt: number; totalPages: number; nonce: string | null }

export function readManifest(payload: Record<string, unknown>): Manifest | null {
  if (payload.manifest !== true) return null;
  if (typeof payload.updatedAt !== 'number' || typeof payload.totalPages !== 'number' || payload.totalPages <= 0) return null;
  // Манифест без nonce — запись ветки до M-2; страницы ищутся только по отметке.
  const nonce = typeof payload.nonce === 'string' && /^[0-9a-z]{6,}$/.test(payload.nonce) ? payload.nonce : null;
  return { updatedAt: payload.updatedAt, totalPages: payload.totalPages, nonce };
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
  const pages: Array<{ row: CloudRow; pageIndex: number; stamp: number | null; nonce: string | null }> = [];
  for (const row of rows) {
    const parsed = parseLocalStoreKey(row.key);
    if (parsed.pageIndex === null) {
      manifest = readManifest(row.payload);
      if (!manifest) single = row;
      continue;
    }
    pages.push({ row, pageIndex: parsed.pageIndex, stamp: parsed.stamp, nonce: parsed.nonce });
  }

  if (manifest) {
    const m = manifest;
    // M-2: манифест называет попытку — читаются только страницы его nonce. Осиротевшие
    // страницы неудавшейся попытки с той же отметкой больше не дают «pages beyond N».
    const own = pages.filter(p => p.stamp === m.updatedAt && (m.nonce === null || p.nonce === m.nonce));
    return assemble(own, m.updatedAt, m.totalPages);
  }
  if (pages.length === 0) return single ? { kind: 'single', row: single } : null;

  // Без манифеста: версии по отметке payload (как в AIRestoreService до S-49).
  const versions = new Map<string, typeof pages>();
  for (const p of pages) {
    const ts = p.row.payload.updatedAt;
    const total = p.row.payload.totalPages;
    // M-2: страницы разных попыток одной отметки не склеиваются — иначе набор из
    // «двух половинок» от двух Writer'ов читался бы как версия с лишними страницами.
    const nonce = typeof p.row.payload.nonce === 'string' ? p.row.payload.nonce : 'x';
    const key = `${typeof ts === 'number' ? ts : 'x'}|${typeof total === 'number' ? total : 'x'}|${nonce}`;
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
