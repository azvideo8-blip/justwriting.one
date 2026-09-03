import MiniSearch from 'minisearch';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { getCurrentUser } from '../../../../core/auth';
import { CACHE_TTL_MS } from './types';
import { searchCache } from './resultCache';

interface MiniSearchCacheEntry {
  instance: MiniSearch;
  builtAt: number;
}
const miniSearchInstances = new Map<string, MiniSearchCacheEntry>();

export function invalidateMiniSearchCache(ownerId?: string): void {
  if (ownerId) {
    miniSearchInstances.delete(ownerId);
  } else {
    miniSearchInstances.clear();
  }
  searchCache.length = 0;
  corpusVersion++;
}

// AUD-23: правка заметки не должна ронять весь индекс и пересобирать его по
// всему архиву. MiniSearch умеет discard/add — обновляем одну запись; полный
// rebuild остаётся для импорта, восстановления и выхода (invalidate выше).
export async function refreshMiniSearchDoc(documentId: string, ownerId?: string): Promise<void> {
  const effectiveOwner = ownerId ?? getCurrentUser()?.uid ?? 'guest';
  const cached = miniSearchInstances.get(effectiveOwner);
  if (!cached) return;
  const ms = cached.instance;
  // Кэш ответов на запросы жил пять минут и раньше сбрасывался вместе с
  // индексом. Точечное обновление без этого оставляло правку невидимой для
  // повторного запроса: индекс свежий, а отдаётся старый ответ.
  searchCache.length = 0;
  try {
    if (ms.has(documentId)) ms.discard(documentId);
    corpusVersion++;
    const db = await getLocalDb();
    const doc = await db.get('documents', documentId);
    if (!doc || doc.excludedFromAI) return;
    const content = await LocalVersionService.getLatestContent(documentId);
    if (!content) return;
    await ms.addAllAsync([{
      id: documentId,
      title: doc.title ?? '',
      content: content.slice(0, 10_000),
    }]);
  } catch {
    // Не смогли обновить точечно — безопасный путь: пересобрать целиком.
    invalidateMiniSearchCache(effectiveOwner);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('auth:signed-out', () => {
    invalidateMiniSearchCache();
  });
  // AUD-23: сохранение версии обновляет одну запись индекса вместо полного
  // пересбора. Если индекс не построен, refresh — no-op.
  window.addEventListener('doc-version-saved', (e) => {
    const detail = (e as CustomEvent<{ documentId?: string }>).detail;
    if (detail?.documentId) void refreshMiniSearchDoc(detail.documentId);
  });
}

// AUDIT-L8: версия корпуса — растёт при любом изменении индекса/заметок.
let corpusVersion = 0;

// AUDIT-L8: дешёвый отпечаток корпуса для ключа кэша. Меняется при любом
// изменении набора заметок/эмбеддингов — устаревший кэш перестаёт совпадать.
const _corpusFpMap = new Map<string, { value: string; computedAt: number }>();
export function corpusFingerprint(ownerId?: string): string {
  const effectiveOwner = ownerId ?? getCurrentUser()?.uid ?? 'guest';
  const cached = _corpusFpMap.get(effectiveOwner);
  if (cached && Date.now() - cached.computedAt < 30_000 && cached.value) return cached.value;
  try {
    const fp = `ms:${effectiveOwner}:${corpusVersion}`;
    _corpusFpMap.set(effectiveOwner, { value: fp, computedAt: Date.now() });
    return fp;
  } catch {
    return 'unknown';
  }
}

export async function getMiniSearch(ownerId?: string): Promise<MiniSearch> {
  const effectiveOwner = ownerId ?? getCurrentUser()?.uid ?? 'guest';
  const cached = miniSearchInstances.get(effectiveOwner);
  if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) return cached.instance;

  const db = await getLocalDb(effectiveOwner);
  const docs = await db.getAll('documents');

  const entries: { id: string; title: string; content: string }[] = [];
  for (const doc of docs) {
    if (doc.excludedFromAI) continue;
    const content = await LocalVersionService.getLatestContent(doc.id);
    if (!content) continue;
    entries.push({
      id: doc.id,
      title: doc.title ?? '',
      content: content.slice(0, 10_000),
    });
  }
  const miniSearchInstance = new MiniSearch({
    fields: ['title', 'content'],
    storeFields: [],
    searchOptions: {
      prefix: true,
      combineWith: 'OR',
      fuzzy: 0.2,
    },
  });
  await miniSearchInstance.addAllAsync(entries);
  miniSearchInstances.set(effectiveOwner, { instance: miniSearchInstance, builtAt: Date.now() });
  return miniSearchInstance;
}

/** BM25 keyword search via MiniSearch with prefix + fuzzy support.
 *  AUD-22: этап размечен — сюда попадает и первая сборка индекса. */
export async function keywordSearch(query: string, topN: number, ownerId?: string): Promise<{ id: string; score: number }[]> {
  const ms = await timed('index_build_or_get', () => getMiniSearch(ownerId));
  const results = ms.search(query);
  return results.slice(0, topN).map(r => ({ id: r.id as string, score: r.score }));
}

// AUD-22: самый частый ход в приложении несёт самый тяжёлый постоянный расход
// (embedding-вызов + сканы IndexedDB). Измерять — прежде чем проектировать:
// в DEV каждый этап поиска оборачивается в performance.measure
// «searchNotes:<этап>», числа видны в Performance-панели или через
// performance.getEntriesByType('measure'). В проде — ноль вызовов.
export async function timed<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  if (!import.meta.env.DEV || typeof performance === 'undefined') return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    try {
      const t1 = performance.now();
      performance.measure(`searchNotes:${stage}`, { start: t0, duration: t1 - t0 });
    } catch { /* измерение не должно ронять поиск */ }
  }
}
