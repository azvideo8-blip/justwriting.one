import { useState, useEffect } from 'react';
import { RU_STOPWORDS as STOP_WORDS } from '../../../core/utils/russianStopwords';
import { getCurrentUser } from '../../../core/auth/supabaseAuthProvider';
import { onDomainEvent } from '../../../core/events/domainEvents';

// v2: expanded stopword filtering — bump so stale caches (full of function
// words) are dropped and rebuilt fresh. The key is per-owner: a shared cache
// leaks the previous account's words even when the query itself is scoped.
const CACHE_KEY_BASE = 'cached_word_cloud_v2';

export interface WordCloudEntry {
  word: string;
  count: number;
}

// Без скоупа облако не строится: getAll тянул заметки предыдущего аккаунта на
// общем браузере, потому что IndexedDB переживает выход. Миграция штампует
// guestId: userId на документах владельца (migrateDocuments), так что
// by-guest-индекс — единый ключ скоупа для гостя и юзера.
export async function rebuildWordCloud(ownerId: string): Promise<void> {
  const { getLocalDb } = await import('../../../core/storage/localDb');
  const db = await getLocalDb();

  const allDocs = await db.getAllFromIndex('documents', 'by-guest', ownerId);
  const docs = allDocs.filter(d => !d.trashedAt);
  const docIds = new Set(docs.map(d => d.id));
  const allSummaries = await db.getAll('aiSummaries');
  const summaries = allSummaries.filter(s => docIds.has(s.documentId));

  const freq: Record<string, number> = {};

  for (const s of summaries) {
    for (const w of s.frequentWords ?? []) {
      const lower = w.toLowerCase();
      if (lower.length < 3 || STOP_WORDS.has(lower)) continue;
      freq[lower] = (freq[lower] ?? 0) + 3;
    }
  }

  for (const doc of docs) {
    const versions = await db.getAllFromIndex('versions', 'by-document', doc.id);
    if (versions.length === 0) continue;
    versions.sort((a, b) => b.version - a.version);
    const content = (versions[0]?.content ?? '').toLowerCase()
      .replace(/[^а-яёa-z\s]/gi, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w));
    for (const w of content) {
      freq[w] = (freq[w] ?? 0) + 1;
    }
  }

  const cloud = Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 30)
    .map(([word, count]) => ({ word, count }));

  try {
    localStorage.setItem(`${CACHE_KEY_BASE}:${ownerId}`, JSON.stringify(cloud));
    localStorage.setItem(`${CACHE_KEY_BASE}:${ownerId}:timestamp`, String(Date.now()));
  } catch { /* quota — non-critical */ }

  window.dispatchEvent(new Event('word-cloud-updated'));
}

export const WORD_CLOUD_TTL_MS = 24 * 60 * 60 * 1000;

export function getWordCloudCachedTimestamp(ownerId: string): number {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY_BASE}:${ownerId}:timestamp`);
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
}

function readCachedCloud(ownerId: string): WordCloudEntry[] {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY_BASE}:${ownerId}`);
    if (cached) return JSON.parse(cached) as WordCloudEntry[];
  } catch { /* non-critical */ }
  return [];
}

export function useArchiveWordCloud(): { wordCloud: WordCloudEntry[]; maxCount: number } {
  const [ownerId, setOwnerId] = useState<string>(() => getCurrentUser()?.uid ?? 'guest');
  const [wordCloud, setWordCloud] = useState<WordCloudEntry[]>(() => readCachedCloud(getCurrentUser()?.uid ?? 'guest'));

  useEffect(() => {
    // Смена аккаунта в той же вкладке: перечитываем кэш нового владельца.
    const syncOwner = () => {
      const id = getCurrentUser()?.uid ?? 'guest';
      setOwnerId(prev => (prev === id ? prev : id));
      setWordCloud(readCachedCloud(id));
    };
    syncOwner();
    window.addEventListener('auth:signed-out', syncOwner);
    return () => window.removeEventListener('auth:signed-out', syncOwner);
  }, []);

  useEffect(() => {
    const lastTimestamp = getWordCloudCachedTimestamp(ownerId);
    const isStale = lastTimestamp === 0 || Date.now() - lastTimestamp > WORD_CLOUD_TTL_MS;

    if (wordCloud.length === 0 || isStale) {
      void rebuildWordCloud(ownerId).catch(() => { /* non-critical */ });
    }

    const onUpdate = () => {
      setWordCloud(readCachedCloud(ownerId));
    };
    window.addEventListener('word-cloud-updated', onUpdate);

    const unsubEvents = onDomainEvent(event => {
      if (
        event.type === 'note.saved' ||
        event.type === 'note.deleted' ||
        event.type === 'note.trashed' ||
        event.type === 'note.restored'
      ) {
        const uid = event.type === 'note.saved' && event.userId ? event.userId : ownerId;
        void rebuildWordCloud(uid).catch(() => {});
      }
    });

    return () => {
      window.removeEventListener('word-cloud-updated', onUpdate);
      unsubEvents();
    };
  }, [wordCloud.length, ownerId]);

  const maxCount = Math.max(...wordCloud.map(w => w.count), 1);

  return { wordCloud, maxCount };
}
