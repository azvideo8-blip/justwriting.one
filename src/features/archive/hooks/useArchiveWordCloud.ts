import { useMemo } from 'react';
import { ArchiveSession } from '../types';

export function useArchiveWordCloud(sessions: ArchiveSession[]) {
  const wordCloudSessions = useMemo(() => sessions.slice(0, 50), [sessions]);

  const wordCloud = useMemo(() => {
    const stopWords = new Set(['и','в','на','с','по','что','это','как','из','он','она','они','мы','вы','я','не','но','а','то','же','бы','за','от','до','так','все','при','уже','или','об','для','его','её','их','мне','мой','моя','мои','нет','да','там','тут','где','когда','если','чтобы','который','которая','которые','которых','был','была','были','есть','быть','было','the','and','for','with','this','that','from','they','have','will','what','been','were','than','which','their','there','when','also','into','some','more','about','would','could','should','these','those','other','after','before']);

    const freq: Record<string, number> = {};
    wordCloudSessions.forEach(s => {
      const snippet = (s.content || '').slice(0, 500).toLowerCase()
        .replace(/[^а-яёa-z\s]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w));
      snippet.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    });

    return Object.entries(freq)
      .sort(([,a],[,b]) => b - a)
      .slice(0, 30)
      .map(([word, count]) => ({ word, count }));
  }, [wordCloudSessions]);

  const maxCount = Math.max(...wordCloud.map(w => w.count), 1);

  return { wordCloud, maxCount };
}
