import { useState, useEffect } from 'react';
import { RU_STOPWORDS as STOP_WORDS } from '../../../core/utils/russianStopwords';

// v2: expanded stopword filtering — bump so stale caches (full of function
// words) are dropped and rebuilt fresh.
const CACHE_KEY = 'cached_word_cloud_v2';

export interface WordCloudEntry {
  word: string;
  count: number;
}

export async function rebuildWordCloud(guestId?: string): Promise<void> {
  const { getLocalDb } = await import('../../../core/storage/localDb');
  const db = await getLocalDb();

  const docs = guestId
    ? await db.getAllFromIndex('documents', 'by-guest', guestId)
    : await db.getAll('documents');
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
    localStorage.setItem(CACHE_KEY, JSON.stringify(cloud));
  } catch { /* quota — non-critical */ }

  window.dispatchEvent(new Event('word-cloud-updated'));
}

export function useArchiveWordCloud(): { wordCloud: WordCloudEntry[]; maxCount: number } {
  const [wordCloud, setWordCloud] = useState<WordCloudEntry[]>(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) return JSON.parse(cached) as WordCloudEntry[];
    } catch { /* non-critical */ }
    return [];
  });

  useEffect(() => {
    if (wordCloud.length === 0) {
      void rebuildWordCloud().catch(() => { /* non-critical */ });
    }

    const onUpdate = () => {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) setWordCloud(JSON.parse(cached) as WordCloudEntry[]);
      } catch { /* non-critical */ }
    };
    window.addEventListener('word-cloud-updated', onUpdate);
    return () => window.removeEventListener('word-cloud-updated', onUpdate);
  }, [wordCloud.length]);

  const maxCount = Math.max(...wordCloud.map(w => w.count), 1);

  return { wordCloud, maxCount };
}
