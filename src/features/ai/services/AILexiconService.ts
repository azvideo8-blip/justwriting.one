import { getLocalDb } from '../../../core/storage/localDb';
import { hasEnoughSignal, SIGNAL_THRESHOLDS } from './signalGate';

export interface VoiceTerm {
  word: string;
  count: number;
  uniqueMonths: number;
}

export interface VoiceMap {
  terms: VoiceTerm[];
  formattedPromptSnippet?: string;
  generatedAt: number;
}

// Stop-words list for Russian and English to exclude generic high-frequency words
const STOP_WORDS = new Set<string>([
  // Russian stop words
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так',
  'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было',
  'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь', 'когда', 'даже', 'ну', 'вдруг',
  'ли', 'если', 'уже', 'или', 'ни', 'быть', 'был', 'него', 'до', 'вас', 'нибудь', 'опять', 'уж',
  'вам', 'ведь', 'там', 'потом', 'себя', 'ничего', 'ей', 'может', 'они', 'тут', 'где', 'есть',
  'надо', 'ней', 'для', 'мы', 'тебя', 'их', 'чем', 'была', 'сам', 'чтоб', 'без', 'будто', 'чего',
  'раз', 'тоже', 'себе', 'под', 'будет', 'ж', 'тогда', 'кто', 'этот', 'того', 'потому', 'этого',
  'какой', 'совсем', 'ним', 'здесь', 'этом', 'один', 'почти', 'мой', 'тем', 'чтобы', 'нее',
  'сейчас', 'были', 'куда', 'зачем', 'всех', 'никогда', 'можно', 'наш', 'свой', 'свои', 'своей',
  'своего', 'очень', 'просто', 'сегодня', 'сразу', 'день', 'время', 'дело', 'год', 'жизнь',

  // English stop words
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with',
  'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
  'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up',
  'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time',
  'no', 'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could',
  'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think',
  'also', 'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even',
  'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
]);

let _voiceMapCache: { voiceMap: VoiceMap | null; cachedAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const AILexiconService = {
  /**
   * Resets the in-memory voice map cache (useful for testing or after data updates).
   */
  clearCache(): void {
    _voiceMapCache = null;
  },

  /**
   * Local aggregation (0 LLM, 0 embeddings) of frequentWords from aiSummaries.
   * Gated by B3 hasEnoughSignal primitive.
   * Returns null if total signal or term dispersion does not meet thresholds.
   */
  async getVoiceMap(options?: { forceRefresh?: boolean }): Promise<VoiceMap | null> {
    if (!options?.forceRefresh && _voiceMapCache && (Date.now() - _voiceMapCache.cachedAt < CACHE_TTL_MS)) {
      return _voiceMapCache.voiceMap;
    }

    const db = await getLocalDb();
    const summaries = await db.getAll('aiSummaries');

    // Collect summary dates and filter valid summaries with frequentWords
    const validSummaries = summaries.filter(s => Array.isArray(s.frequentWords) && s.frequentWords.length > 0);
    const summaryDates = validSummaries.map(s => s.eventDate ?? s.processedAt);

    // B3 signal gate check (overall dataset must have >= minCount summaries across >= minUniqueMonths)
    const hasSignal = hasEnoughSignal(
      { count: validSummaries.length, dates: summaryDates },
      SIGNAL_THRESHOLDS.lexicon
    );

    if (!hasSignal) {
      _voiceMapCache = { voiceMap: null, cachedAt: Date.now() };
      return null;
    }

    // Aggregate term stats: word -> { count, months: Set<string (YYYY-MM)> }
    const termStats = new Map<string, { count: number; months: Set<string> }>();

    for (const summary of validSummaries) {
      const rawDate = summary.eventDate ?? summary.processedAt;
      const month = typeof rawDate === 'string'
        ? rawDate.slice(0, 7)
        : new Date(rawDate).toISOString().slice(0, 7);

      for (const rawWord of summary.frequentWords) {
        const normalized = rawWord.toLowerCase().trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if (!normalized || normalized.length < 2 || STOP_WORDS.has(normalized)) {
          continue;
        }

        const existing = termStats.get(normalized);
        if (existing) {
          existing.count += 1;
          existing.months.add(month);
        } else {
          termStats.set(normalized, { count: 1, months: new Set([month]) });
        }
      }
    }

    // Filter terms with temporal dispersion (must appear in >= 2 unique months & count >= 2)
    const terms: VoiceTerm[] = [];
    for (const [word, stats] of termStats.entries()) {
      if (stats.count >= 2 && stats.months.size >= 2) {
        terms.push({
          word,
          count: stats.count,
          uniqueMonths: stats.months.size,
        });
      }
    }

    if (terms.length === 0) {
      _voiceMapCache = { voiceMap: null, cachedAt: Date.now() };
      return null;
    }

    // Rank terms by score = count * uniqueMonths (higher frequency & higher month dispersion first)
    terms.sort((a, b) => {
      const scoreA = a.count * a.uniqueMonths;
      const scoreB = b.count * b.uniqueMonths;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return b.count - a.count;
    });

    const topTerms = terms.slice(0, 15);

    const voiceMap: VoiceMap = {
      terms: topTerms,
      formattedPromptSnippet: topTerms.map(t => t.word).join(', '),
      generatedAt: Date.now(),
    };

    _voiceMapCache = { voiceMap, cachedAt: Date.now() };
    return voiceMap;
  },
};
