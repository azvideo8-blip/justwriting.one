import { useState, useEffect } from 'react';

const CACHE_KEY = 'cached_word_cloud';

export interface WordCloudEntry {
  word: string;
  count: number;
}

const STOP_WORDS = new Set([
  'и','в','на','с','по','что','это','как','из','он','она','они','мы','вы','я','не','но','а','то','же','бы','за','от','до',
  'так','все','при','уже','или','об','для','его','её','их','мне','мой','моя','мои','нет','да','там','тут','где','когда',
  'если','чтобы','который','которая','которые','которых','был','была','были','есть','быть','было',
  'the','and','for','with','this','that','from','they','have','will','what','been','were','than','which','their','there',
  'when','also','into','some','more','about','would','could','should','these','those','other','after','before',
  'очень','только','просто','меня','мной','себя','себе','потом','тогда','сейчас','сегодня','завтра','вчера',
  'день','утро','время','раз','нужно','надо','хочу','могу','буду','делать','сделать',
  'нет','да','ну','вот','там','тут','здесь','этом','этого','всё','все','весь','более','менее',
  'может','пока','ничего','делаю','понимаю','знаю','пишу','писал','говорю','сказал','типа','вообще','думаю',
  'чувствую','получается','значит','нормально',
]);

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
