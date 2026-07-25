import { reportError } from '../../../shared/errors/reportError';

let totalStrippedDatesCount = 0;

export function getStrippedDatesCount(): number {
  return totalStrippedDatesCount;
}

export function resetStrippedDatesCount(): void {
  totalStrippedDatesCount = 0;
}

export interface YearMonth {
  year: number;
  month: number;
}

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  январ: 1,
  феврал: 2,
  март: 3,
  марта: 3,
  марте: 3,
  апрел: 4,
  май: 5,
  мая: 5,
  мае: 5,
  июн: 6,
  июл: 7,
  август: 8,
  сентябр: 9,
  октябр: 10,
  ноябр: 11,
  декабр: 12,
};

/**
 * Parses a date string or snippet into { year, month } (1-indexed month).
 */
export function parseMonthYear(dateStr: string): YearMonth | null {
  if (!dateStr || typeof dateStr !== 'string') return null;

  // 1. ISO format: YYYY-MM-DD or YYYY-MM
  const isoMatch = dateStr.match(/(?:^|[^\d])(\d{4})-(\d{1,2})(?:[^\d]|$)/);
  if (isoMatch && isoMatch[1] && isoMatch[2]) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12) {
      return { year, month };
    }
  }

  // 2. Numeric DD.MM.YYYY or MM.YYYY
  const numMatch = dateStr.match(/(?:^|[^\d])(?:\d{1,2}\.)?(\d{1,2})\.(\d{4})(?:[^\d]|$)/);
  if (numMatch && numMatch[1] && numMatch[2]) {
    const month = parseInt(numMatch[1], 10);
    const year = parseInt(numMatch[2], 10);
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12) {
      return { year, month };
    }
  }

  // 3. Russian month name + 4 digit year
  const ruMatch = dateStr.match(/(?:^|[\s,.(])(января|январе|февраля|феврале|марта|марте|апреля|апреле|мая|мае|июня|июне|июля|июле|августа|августе|сентября|сентябре|октября|октябре|ноября|ноябре|декабря|декабре|январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)\s+(\d{4})(?:[^\d]|$)/iu);
  if (ruMatch && ruMatch[1] && ruMatch[2]) {
    const monthName = ruMatch[1].toLowerCase();
    const year = parseInt(ruMatch[2], 10);
    let month: number | undefined;

    for (const [stem, mNum] of Object.entries(MONTH_NAME_TO_NUMBER)) {
      if (monthName.startsWith(stem)) {
        month = mNum;
        break;
      }
    }

    if (month && year >= 1900 && year <= 2100) {
      return { year, month };
    }
  }

  return null;
}

/**
 * Extracts ISO dates (YYYY-MM-DD) from injected context lines containing first-seen claims.
 */
export function extractFirstSeenDates(text: string | null | undefined): string[] {
  if (!text) return [];
  const dates: string[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (/впервые/i.test(line)) {
      const matches = line.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g);
      for (const m of matches) {
        if (m[1]) dates.push(m[1]);
      }
    }
  }
  return [...new Set(dates)];
}

const FIRST_SEEN_PHRASING_REGEX = /(?:впервые\s+(?:записал|записала|записал\(а\)|появил|появилась|появился|появилось|связал|связала|упомянул|упомянула|сформулировал|сформулировала|отметил|отметила|звучит|встретил|встретилась|встретилось|возникл|проявил|мысль)|впервые\b)/i;

const RUSSIAN_MONTH_DATE_REGEX = /(?:\b(?:от|с|в|на)\s+)?(?:\d{1,2}\s+)?(?:января|январе|февраля|феврале|марта|марте|апреля|апреле|мая|мае|июня|июне|июля|июле|августа|августе|сентября|сентябре|октября|октябре|ноября|ноябре|декабря|декабре|январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)\s+\d{4}(?:\s*года|\s*г\.)?/gi;
const ISO_DATE_REGEX = /\s*\(?\s*\b\d{4}-\d{2}(?:-\d{2})?\b\s*\)?/gi;
const NUMERIC_DATE_REGEX = /\s*\(?\s*\b\d{1,2}\.\d{2}\.\d{4}\b\s*\)?/gi;

function cleanStrippedSentence(sentence: string): string {
  return sentence
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\b(?:в|от|с|на)\s+([.,!?])/gi, '$1')
    .replace(/\s*\(\s*\)/g, '')
    .trim();
}

/**
 * Guard for first-seen dates in AI responses.
 * Compares any first-seen date against allowedDates at month+year granularity.
 * If unvalidated or missing, strips the date from the first-seen sentence while keeping the sentence structure intact.
 */
export function sanitizeFirstSeenDates(text: string, allowedDates: string[]): string {
  if (!text) return text;

  const allowedMonthYears = new Set<string>();
  for (const d of allowedDates) {
    const ym = parseMonthYear(d);
    if (ym) {
      allowedMonthYears.add(`${ym.year}-${ym.month}`);
    }
  }

  // Split into sentence blocks preserving separators
  const sentences = text.split(/(?<=[.!?\n])\s+/);

  const processedSentences = sentences.map(sentence => {
    // Only inspect sentences that contain first-seen phrasing
    if (!FIRST_SEEN_PHRASING_REGEX.test(sentence)) {
      return sentence;
    }

    let currentSentence = sentence;
    let modified = false;

    // Helper to process date matches
    const inspectAndStrip = (matchText: string, fullMatch: string) => {
      const parsed = parseMonthYear(matchText);
      if (!parsed) return;

      const key = `${parsed.year}-${parsed.month}`;
      if (!allowedMonthYears.has(key)) {
        // Date is not allowed — strip it
        currentSentence = currentSentence.replace(fullMatch, ' ');
        modified = true;
        totalStrippedDatesCount++;
        reportError(
          new Error(`[DateGuard] Stripped unvalidated first-seen date "${matchText}" from sentence`),
          { action: 'sanitizeFirstSeenDates' },
          'warning'
        );
      }
    };

    // 1. Check Russian Month dates
    const ruMatches = [...currentSentence.matchAll(RUSSIAN_MONTH_DATE_REGEX)];
    for (const m of ruMatches) {
      if (m[0]) inspectAndStrip(m[0], m[0]);
    }

    // 2. Check ISO dates
    const isoMatches = [...currentSentence.matchAll(ISO_DATE_REGEX)];
    for (const m of isoMatches) {
      if (m[0]) inspectAndStrip(m[0], m[0]);
    }

    // 3. Check Numeric dates
    const numMatches = [...currentSentence.matchAll(NUMERIC_DATE_REGEX)];
    for (const m of numMatches) {
      if (m[0]) inspectAndStrip(m[0], m[0]);
    }

    if (modified) {
      return cleanStrippedSentence(currentSentence);
    }

    return sentence;
  });

  return processedSentences.join(' ');
}
