import { ANSWER_REF_RE } from '../../../shared/ai/notesRefRule';
import { HYPOTHESIS_TURN_MARK } from '../../../shared/ai/hypothesisRule';

/**
 * HY-2: дата рядом со ссылкой на запись — дата этой записи. Только на ходе с
 * гипотезой: там ответ пересказывает несколько записей и путает их даты, а
 * просьбу «дат не называй» модель не выполняет (стенд ai-hypotheses, v6).
 * Трогаем только однозначное: в предложении одна ссылка и одна дата «число месяц».
 */
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DAY_MONTH_RE = /(?<![\d.])(\d{1,2})\s+(?:январ|феврал|март|апрел|ма(?=[яйе])|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-яё]*/gi;
// Шапка записи в материалах хода: `[#<id> · YYYY-MM-DD]` (hypothesisTurn.buildAnchorBlock, aiChatContext).
const HEADER_RE = /\[#([^\]\s]{1,120}?) · (\d{4}-\d{2}-\d{2})\]/g;

/** id → дата записи из материалов хода; null — ход не с гипотезой. */
export function hypothesisCitedDates(searchContext: string | null | undefined): Map<string, string> | null {
  if (!searchContext || !searchContext.includes(HYPOTHESIS_TURN_MARK)) return null;
  const byId = new Map<string, string>();
  for (const m of searchContext.matchAll(HEADER_RE)) if (m[1] && m[2]) byId.set(m[1], m[2]);
  return byId.size > 0 ? byId : null;
}

export function fixCitedDates(text: string, dateById: ReadonlyMap<string, string>): string {
  return text.split(/(?<=[.!?…])(\s+)/).map((part, i) => {
    if (i % 2 === 1) return part; // разделитель
    const ids = [...new Set([...part.matchAll(ANSWER_REF_RE)].map(m => m[1]).filter((x): x is string => Boolean(x)))];
    const iso = ids.length === 1 ? dateById.get(ids[0]!) : undefined;
    const dates = [...part.matchAll(DAY_MONTH_RE)];
    if (!iso || dates.length !== 1) return part; // неоднозначно — не трогаем
    const right = `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]}`;
    return part.replace(DAY_MONTH_RE, right);
  }).join('');
}