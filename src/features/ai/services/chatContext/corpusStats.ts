import { getLocalDb } from '../../../../core/storage/localDb';
import { isExcludedFromAI } from '../../utils/isExcludedFromAI';

export function formatDateYYYYMMDD(timestamp: number | undefined): string {
  if (!timestamp) return 'unknown-date';
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// How much the search actually covered. Without it the model has no idea
// whether the notes in front of it are the whole archive or a handful, and it
// guesses — which is how "I only see the two you sent" gets said about a search
// over the entire corpus.
export async function getCorpusStats(db: Awaited<ReturnType<typeof getLocalDb>>): Promise<{ total: number; from: string; to: string }> {
  const docs = (await db.getAll('documents')).filter(d => !isExcludedFromAI(d));
  const dates = docs.map(d => d.lastSessionAt || d.firstSessionAt || 0).filter(Boolean).sort((a, b) => a - b);
  return {
    total: docs.length,
    from: formatDateYYYYMMDD(dates[0]),
    to: formatDateYYYYMMDD(dates[dates.length - 1]),
  };
}

export async function getDocDate(docId: string): Promise<string> {
  try {
    const db = await getLocalDb();
    const doc = await db.get('documents', docId);
    // R4-020: как в noteMetaFor — без последней сессии берём дату создания,
    // а не «сегодня»: разбор заметки от 29 июля датировался днём запроса.
    if (doc && (doc.lastSessionAt || doc.firstSessionAt)) {
      return formatDateYYYYMMDD(doc.lastSessionAt ?? doc.firstSessionAt);
    }
  } catch { /* ignore */ }
  return formatDateYYYYMMDD(Date.now());
}
