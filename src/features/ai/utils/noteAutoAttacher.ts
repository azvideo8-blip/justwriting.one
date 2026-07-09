// Auto-pull: "разбери/прочитай (мою)? (последнюю|сегодняшнюю|вчерашнюю|свежую)? заметку/аскезу"
export const NOTE_REF_RE = /(заметк|запис|аскез)/i;
export const NOTE_VERB_RE = /(разбер|разбор|проанализ|анализ|прочит|посмотр|глян)/i;

export type DocLite = { id: string; title?: string | undefined; lastSessionAt?: number; firstSessionAt?: number };

export function sameCalendarDay(ms: number, ref: Date): boolean {
  const d = new Date(ms);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

export function pickNoteByText<T extends DocLite>(docs: T[], text: string): T | null {
  if (docs.length === 0) return null;
  const recent = [...docs].sort((a, b) => (b.lastSessionAt ?? b.firstSessionAt ?? 0) - (a.lastSessionAt ?? a.firstSessionAt ?? 0));
  const now = new Date();
  if (/сегодняшн|сегодня/i.test(text)) return recent.find(d => sameCalendarDay(d.lastSessionAt ?? d.firstSessionAt ?? 0, now)) ?? recent[0] ?? null;
  if (/вчерашн|вчера/i.test(text)) { const y = new Date(now); y.setDate(now.getDate() - 1); return recent.find(d => sameCalendarDay(d.lastSessionAt ?? d.firstSessionAt ?? 0, y)) ?? recent[0] ?? null; }

  // Vague-reference words that do NOT count as a specific title match
  const VAGUE_PREFIXES = ['последн', 'свеж', 'недавн', 'прошл'];
  const VAGUE_EXACT = new Set(['мою', 'эту', 'про', 'о', 'об', 'по', 'на', 'тему']);
  const isVague = (w: string): boolean =>
    VAGUE_EXACT.has(w) || VAGUE_PREFIXES.some(p => w.startsWith(p));

  // Strip trigger/verb refs, then tokenize into word and number tokens
  const rawTokens = text
    .replace(NOTE_REF_RE, ' ')
    .replace(NOTE_VERB_RE, ' ')
    .split(/[^a-zа-яё0-9]+/i)
    .map(w => w.toLowerCase().trim())
    .filter(w => w.length > 0);

  const queryWords: string[] = [];
  const queryNumbers: string[] = [];
  for (const w of rawTokens) {
    if (/^\d+$/.test(w)) {
      queryNumbers.push(w);
    } else if (w.length >= 3 && /^[a-zа-яё]+$/i.test(w) && !isVague(w)) {
      queryWords.push(w);
    }
  }

  // Specificity: >=1 NUMBER token OR >=1 non-vague WORD token of length>=4
  const isSpecific = queryNumbers.length >= 1 || queryWords.some(w => w.length >= 4);

  if (isSpecific) {
    let best: T | null = null;
    let bestScore = 0;

    for (const d of recent) {
      const title = (d.title ?? '').toLowerCase();
      if (!title) continue;

      const titleTokens = title.split(/[^a-zа-яё0-9]+/i).filter(t => t.length > 0);
      const titleNumbers = titleTokens.filter(t => /^\d+$/.test(t));
      const titleWords = titleTokens.filter(t => !/^\d+$/.test(t));

      // NUMBER gate: EVERY query number must be an EXACT title number (not substring)
      if (queryNumbers.length > 0 && !queryNumbers.every(qn => titleNumbers.includes(qn))) continue;

      let score = 0;
      for (const qn of queryNumbers) {
        if (titleNumbers.includes(qn)) score++;
      }
      for (const qw of queryWords) {
        if (titleWords.some(tw => tw.includes(qw) || qw.includes(tw))) score++;
      }

      if (score > bestScore) { bestScore = score; best = d; }
    }

    // Must cover all numbers AND at least one word (when word tokens exist)
    const required = queryWords.length > 0 ? queryNumbers.length + 1 : queryNumbers.length;
    if (best && bestScore >= required) return best;
    return null; // specific query, no qualifying doc → attach nothing
  }

  return recent[0] ?? null; // последнюю / свежую / мою / эту → самая свежая
}
