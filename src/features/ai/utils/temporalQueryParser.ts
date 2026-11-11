import { localDayKey } from '../../../core/utils/dateUtils';
export interface TemporalQuery {
  type: 'month' | 'dateRange' | 'recent' | 'none';
  month?: string | undefined;        // YYYY-MM if type=month
  from?: string | undefined;         // YYYY-MM-DD if type=dateRange
  to?: string | undefined;
  /** Бытовое название окна («вчера», «на этой неделе») — оно идёт в контекст. */
  phrase?: string | undefined;
  rawText: string;
}

export const MONTHS_MAP: Record<string, string> = {
  'январ': '01',
  'феврал': '02',
  'март': '03',
  'апрел': '04',
  'май': '05',
  'мае': '05',
  'мая': '05',
  'июн': '06',
  'июл': '07',
  'август': '08',
  'сентябр': '09',
  'октябр': '10',
  'ноябр': '11',
  'декабр': '12'
};

const DAY_MS = 86_400_000;
/** Без года дата в будущем дальше этого окна — прошлый год (как FN-1/C8). */
const PREV_YEAR_WINDOW_DAYS = 92;
const DATE_MONTH_STEM = '(январ[ьяе]?|феврал[ьяе]?|март[аеу]?|апрел[ьяе]?|ма[йея]|июн[ьяе]?|июл[ьяе]?|август[аеу]?|сентябр[ьяе]?|октябр[ьяе]?|ноябр[ьяе]?|декабр[ьяе]?)';

function monthNumberOf(stem: string): number | undefined {
  const word = stem.toLowerCase();
  if (word.startsWith('ма') && word.length === 3) return 5;
  const key = Object.keys(MONTHS_MAP).find(k => word.startsWith(k));
  return key ? parseInt(MONTHS_MAP[key]!, 10) : undefined;
}

function dayKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function validDay(y: number, m: number, d: number): boolean {
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}

/** Год без названия: этот, а если дата ещё далеко впереди — прошлый. */
function yearFor(m: number, d: number, today: Date): number {
  const y = today.getFullYear();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const candidate = new Date(y, m - 1, d).getTime();
  return candidate - todayStart > PREV_YEAR_WINDOW_DAYS * DAY_MS ? y - 1 : y;
}

const SEASON_START: Record<string, number> = { весн: 3, лет: 6, осен: 9, зим: 12 };
// «лет[оа]», не «лету»: «с лету» — оборот, а не период (ревью 0.11.10).
const SEASON_WORD = '(весн[аыуе]|лет[оа]|осен[ьи]|зим[аыуе])';

/** Первый день месяца или времени года: названный год, иначе — последний уже начавшийся. */
function periodStart(word: string, year: string | undefined, now: Date): Date | undefined {
  const seasonKey = Object.keys(SEASON_START).find(k => word.startsWith(k));
  const m = seasonKey ? SEASON_START[seasonKey] : monthNumberOf(word);
  if (!m) return undefined;
  const y = year ? parseInt(year, 10) : (new Date(now.getFullYear(), m - 1, 1) <= now ? now.getFullYear() : now.getFullYear() - 1);
  return new Date(y, m - 1, 1);
}

/** Сколько месяцев длится названное: месяц — 1, время года — 3. */
function periodMonths(word: string): number {
  return Object.keys(SEASON_START).some(k => word.startsWith(k)) ? 3 : 1;
}

export function parseOpenRange(lowerText: string, now: Date): { from: string; to: string } | null {
  const LB = '(?:^|[^а-яёa-z0-9])';
  const RB = '(?![а-яёa-z0-9])';
  const unit = `(?:${DATE_MONTH_STEM}|${SEASON_WORD})`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const clip = (d: Date) => localDayKey(d > today ? today : d);
  // с <месяц|сезон> [год] [до|по <месяц|сезон> [год]]
  const since = lowerText.match(new RegExp(`${LB}с\\s+${unit}(?:\\s+(\\d{4}))?(?:\\s+(?:до|по)\\s+${unit}(?:\\s+(\\d{4}))?)?${RB}`, 'i'));
  if (since) {
    const startWord = since[1] ?? since[2];
    const start = startWord ? periodStart(startWord, since[3], now) : undefined;
    if (start && start <= today) {
      const endWord = since[4] ?? since[5];
      if (!endWord) return { from: localDayKey(start), to: localDayKey(today) };
      // Конец — первое такое время после начала: «с ноября до марта» переходит через год.
      let from = start;
      let end = periodStart(endWord, since[6] ?? String(start.getFullYear()), now);
      if (end && end < start && !since[6]) end = new Date(end.getFullYear() + 1, end.getMonth(), 1);
      // Ревью 0.11.10 (Qoder): конец ещё не наступил и годы не названы — речь о прошлом
      // таком периоде. «с ноября до марта» 11 ноября — это прошлая зима, а не 11 дней.
      if (end && end > today && !since[3] && !since[6]) {
        from = new Date(start.getFullYear() - 1, start.getMonth(), 1);
        end = new Date(end.getFullYear() - 1, end.getMonth(), 1);
      }
      if (end) return { from: localDayKey(from), to: clip(new Date(end.getFullYear(), end.getMonth() + periodMonths(endWord), 0)) };
    }
  }
  // за [эту|прошлую|всю] осень
  const season = lowerText.match(new RegExp(`${LB}за\\s+(?:(?:эт[уо]|прошл(?:ую|ое)|вс[юеё])\\s+)?(весну|лето|осень|зиму)${RB}`, 'i'));
  if (season) {
    const start = periodStart(season[1]!, undefined, now);
    if (start) return { from: localDayKey(start), to: clip(new Date(start.getFullYear(), start.getMonth() + 3, 0)) };
  }
  return null;
}

/** PR-4: «за две недели», «за 14 дней», «за последнюю неделю» — от сегодня.
 *  Ревью 0.10.12: слово целиком («за деньги» — не срок) и не «за неделю до …»
 *  (это точка в прошлом, а не последние дни). */
const SPAN_NUMBER = '(\\d{1,3}|одну|один|одна|две|два|три|четыре|пять|шесть|семь|восемь|девять|десять|одиннадцать|двенадцать)';
const SPAN_NUMBERS: Record<string, number> = {
  одну: 1, один: 1, одна: 1, две: 2, два: 2, три: 3, четыре: 4, пять: 5,
  шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12,
};

function parseRelativeSpan(lowerText: string, today: Date): TemporalQuery | null {
  const re = new RegExp(
    `(?:^|[^а-яё])(?:за\\s+)(?:(?:последние|последних|последнюю|последний|прошлые|прошлую)\\s+)?(?:${SPAN_NUMBER}\\s+)?(недел[юиь]|дней|дня|день)(?![а-яё])(?!\\s+до(?![а-яё]))`,
    'i',
  );
  const m = lowerText.match(re);
  if (!m) return null;
  const raw = m[1];
  const count = raw ? (SPAN_NUMBERS[raw] ?? parseInt(raw, 10)) : 1;
  if (!Number.isFinite(count) || count < 1 || count > 365) return null;
  const days = m[2]!.startsWith('недел') ? count * 7 : count;
  const toDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - days);
  return {
    type: 'dateRange',
    from: dayKey(fromDate.getFullYear(), fromDate.getMonth() + 1, fromDate.getDate()),
    to: dayKey(toDate.getFullYear(), toDate.getMonth() + 1, toDate.getDate()),
    rawText: '',
  };
}

interface ParsedRange { from: string; to: string }

/** «с 10 [октября] по 24 октября [2024]» — месяц берётся из второй даты. */
function parseMonthRange(lowerText: string, today: Date): ParsedRange | null {
  const re = new RegExp(
    `(?:^|[^а-яёА-ЯЁ\\d])с\\s+(\\d{1,2})(?:\\s+${DATE_MONTH_STEM})?(?:\\s+(\\d{4}))?\\s*(?:по|[—–-])\\s*(\\d{1,2})\\s+${DATE_MONTH_STEM}(?:\\s+(\\d{4}))?`,
    'i',
  );
  const m = lowerText.match(re);
  if (!m) return null;
  const firstMonthStem = m[2];
  const m1 = firstMonthStem ? monthNumberOf(firstMonthStem) : monthNumberOf(m[5]!);
  const m2 = monthNumberOf(m[5]!);
  const d1 = parseInt(m[1]!, 10);
  const d2 = parseInt(m[4]!, 10);
  if (!m1 || !m2) return null;
  const explicit1 = m[3] ? parseInt(m[3], 10) : undefined;
  const explicit2 = m[6] ? parseInt(m[6], 10) : undefined;
  const y2 = explicit2 ?? explicit1 ?? yearFor(m2, d2, today);
  let y1 = explicit1 ?? y2;
  if (explicit1 === undefined && m1 > m2) y1 -= 1;
  if (!validDay(y1, m1, d1) || !validDay(y2, m2, d2)) return null;
  return { from: dayKey(y1, m1, d1), to: dayKey(y2, m2, d2) };
}

/** «с 10.10 по 24.10» — числовой диапазон; «9.40» месяцем не считается. */
function parseNumericRange(lowerText: string, today: Date): ParsedRange | null {
  const re = /(?:^|[^0-9.])(?:с\s+)?(\d{1,2})\.(\d{2})(?:\.(\d{2,4}))?\s*(?:по|[—–-])\s*(\d{1,2})\.(\d{2})(?:\.(\d{2,4}))?/;
  const m = lowerText.match(re);
  if (!m) return null;
  const d1 = parseInt(m[1]!, 10);
  const m1 = parseInt(m[2]!, 10);
  const d2 = parseInt(m[4]!, 10);
  const m2 = parseInt(m[5]!, 10);
  if (m1 < 1 || m1 > 12 || m2 < 1 || m2 > 12) return null;
  const explicitYear = (v: string | undefined) => (v ? (v.length === 2 ? 2000 + parseInt(v, 10) : parseInt(v, 10)) : undefined);
  const explicit1 = explicitYear(m[3]);
  const explicit2 = explicitYear(m[6]);
  const y2 = explicit2 ?? explicit1 ?? yearFor(m2, d2, today);
  let y1 = explicit1 ?? y2;
  if (explicit1 === undefined && m1 > m2) y1 -= 1;
  if (!validDay(y1, m1, d1) || !validDay(y2, m2, d2)) return null;
  return { from: dayKey(y1, m1, d1), to: dayKey(y2, m2, d2) };
}

/** «10 октября [2024]» — этот день; «с 10 октября» — с него по сегодня. */
function parseSingleDate(lowerText: string, today: Date): TemporalQuery | null {
  const re = new RegExp(`(?:^|[^а-яёА-ЯЁ\\d.])(с\\s+)?(\\d{1,2})\\s+${DATE_MONTH_STEM}(?:\\s+(\\d{4}))?`, 'i');
  const m = lowerText.match(re);
  if (!m) return null;
  const mNum = monthNumberOf(m[3]!);
  const d = parseInt(m[2]!, 10);
  if (!mNum) return null;
  const y = m[4] ? parseInt(m[4], 10) : yearFor(mNum, d, today);
  if (!validDay(y, mNum, d)) return null;
  const from = dayKey(y, mNum, d);
  const todayKey = dayKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
  if (!m[1]) return { type: 'dateRange', from, to: from, rawText: '' };
  return { type: 'dateRange', from, to: from > todayKey ? from : todayKey, rawText: '' };
}

export function parseTemporalQuery(text: string): TemporalQuery {
  const rawText = text;
  const lowerText = text.toLowerCase().trim();
  const now = new Date();

  // PR-1: период и одиночная дата — до месяца. Иначе «с 10 октября по 24
  // октября» отдавало весь октябрь, а «10 октября» — тоже весь месяц.
  const range = parseMonthRange(lowerText, now) ?? parseNumericRange(lowerText, now);
  if (range) return { type: 'dateRange', ...range, rawText };
  // «с июня», «с лета до октября», «за осень»: открытый период и времена года.
  // Раньше «как с июня менялось…» срезалось до одного июня, а «с лета до
  // октября» — до одного октября (стенд ai-memory-base-fable-2026-11, Q19/Q20).
  const open = parseOpenRange(lowerText, now);
  if (open) return { type: 'dateRange', ...open, rawText };
  const single = parseSingleDate(lowerText, now);
  if (single) return { ...single, rawText };
  const span = parseRelativeSpan(lowerText, now);
  if (span) return { ...span, rawText };

  // 1. Match Russian Months (nominative, genitive, prepositional etc)
  // e.g. "в апреле", "в марте 2025", "за январь 2024"
  const monthRegex = /(?:^|[^а-яёА-ЯЁa-zA-Z0-9])(?:в|за|около)?\s*(январ|феврал|март|апрел|ма[йея]|июн|июл|август|сентябр|октябр|ноябр|декабр)(?:е|я|а|ь|у)?(?:\s+(\d{4}))?(?![а-яёА-ЯЁa-zA-Z0-9])/i;
  const monthMatch = lowerText.match(monthRegex);
  if (monthMatch) {
    const monthStem = monthMatch[1]!.toLowerCase();
    const monthNum = MONTHS_MAP[monthStem] || MONTHS_MAP[monthStem.slice(0, 5)];
    if (monthNum) {
      const year = monthMatch[2] ? parseInt(monthMatch[2], 10) : new Date().getFullYear();
      const monthStr = `${year}-${monthNum}`;
      return { type: 'month', month: monthStr, rawText };
    }
  }

  // 2. Match relative dates / ranges
  // "на прошлой неделе" -> last 7 days
  if (/(?:^|[^а-яёА-ЯЁa-zA-Z0-9])на\s+прошлой\s+неделе(?![а-яёА-ЯЁa-zA-Z0-9])/i.test(lowerText)) {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(toDate.getDate() - 7);
    return {
      type: 'dateRange',
      from: localDayKey(fromDate),
      to: localDayKey(toDate),
      rawText
    };
  }

  // "в прошлом месяце" -> previous calendar month (month type)
  if (/(?:^|[^а-яёА-ЯЁa-zA-Z0-9])в\s+прошлом\s+месяце(?![а-яёА-ЯЁa-zA-Z0-9])/i.test(lowerText)) {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const year = d.getFullYear();
    const monthNum = String(d.getMonth() + 1).padStart(2, '0');
    return {
      type: 'month',
      month: `${year}-${monthNum}`,
      rawText
    };
  }

  // "в этом году" -> from Jan 1st to today
  if (/(?:^|[^а-яёА-ЯЁa-zA-Z0-9])в\s+этом\s+году(?![а-яёА-ЯЁa-zA-Z0-9])/i.test(lowerText)) {
    const toDate = new Date();
    const year = toDate.getFullYear();
    return {
      type: 'dateRange',
      from: `${year}-01-01`,
      to: localDayKey(toDate),
      rawText
    };
  }

  // "в начале года" -> YYYY-01-01 to YYYY-04-30
  if (/(?:^|[^а-яёА-ЯЁa-zA-Z0-9])в\s+начале\s+года(?![а-яёА-ЯЁa-zA-Z0-9])/i.test(lowerText)) {
    const year = new Date().getFullYear();
    return {
      type: 'dateRange',
      from: `${year}-01-01`,
      to: `${year}-04-30`,
      rawText
    };
  }

  // "давно" -> YYYY-01-01 (or 1 year ago) to 30 days ago
  if (/(?:^|[^а-яёА-ЯЁa-zA-Z0-9])давно(?![а-яёА-ЯЁa-zA-Z0-9])/i.test(lowerText)) {
    const toDate = new Date();
    toDate.setDate(toDate.getDate() - 30);
    const fromDate = new Date();
    fromDate.setFullYear(fromDate.getFullYear() - 1);
    return {
      type: 'dateRange',
      from: localDayKey(fromDate),
      to: localDayKey(toDate),
      rawText
    };
  }

  // X-4: окно по дням и неделе. Без этого правила «что я писал вчера?»
  // долетало до catch-up-ветки и получало две недели последних событий вместо
  // вчерашнего дня. Порядок важен: правило стоит ДО поисковика имён, иначе
  // «о чём я писал вчера» теряло окно. Хвост слова не ограничивается:
  // «вчерашний день» — то же вчера.
  const boundary = '(?:^|[^а-яёА-ЯЁa-zA-Z0-9])';
  const noTail = '(?![а-яёА-ЯЁa-zA-Z0-9])';
  // Окно — только для вопроса о записях. «Вчера я поругался с мамой, что
  // делать» — рассказ о событии: окно в один день отрезало бы старые заметки
  // про маму и сообщило модели «за вчера записей нет».
  // Короткий вопрос («за вчерашний день что?») — тоже о записях; длинный с «?»
  // («вчера поругался с мамой, что делать?») — о событии.
  const shortQuestion = lowerText.includes('?') && lowerText.split(/\s+/).filter(Boolean).length <= 5;
  // PR-4: одиночное бытовое окно — это просьба о записях, даже без «что было».
  // Рассказ («вчера я поругался с мамой») сюда не попадает — лишние слова.
  const bareWindow = /^(?:(?:что|чего|какие|покажи|напомни|расскажи)\s+)?(?:было\s+)?(?:на\s+)?(?:этой\s+неделе|вчера|позавчера|сегодня)$/i.test(lowerText.trim());
  const asksAboutNotes = shortQuestion || bareWindow
    || /писал|записал|запис[иья]|заметк|дневник|что\s+было|что\s+нового|что\s+я\s+делал|чем\s+я\s+занима/i.test(lowerText);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dayBeforeYesterday = new Date();
  dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);

  if (new RegExp(`${boundary}(позавчераш|позавчера)`, 'i').test(lowerText) && asksAboutNotes) {
    return {
      type: 'dateRange',
      from: localDayKey(dayBeforeYesterday),
      to: localDayKey(dayBeforeYesterday),
      phrase: 'позавчера',
      rawText
    };
  }

  if (new RegExp(`${boundary}(вчераш|вчера)`, 'i').test(lowerText) && asksAboutNotes) {
    return {
      type: 'dateRange',
      from: localDayKey(yesterday),
      to: localDayKey(yesterday),
      phrase: 'вчера',
      rawText
    };
  }

  if (new RegExp(`${boundary}(сегодняш|сегодня)`, 'i').test(lowerText) && asksAboutNotes) {
    const today = new Date();
    return {
      type: 'dateRange',
      from: localDayKey(today),
      to: localDayKey(today),
      phrase: 'сегодня',
      rawText
    };
  }

  // «на этой неделе» — от понедельника до сегодня; «на прошлой неделе» уже
  // разобрано выше и сюда не доходит.
  if (new RegExp(`${boundary}(?:на\\s+)?этой\\s+нед(еле|ели)${noTail}`, 'i').test(lowerText) && asksAboutNotes) {
    const today = new Date();
    const weekday = (today.getDay() + 6) % 7; // понедельник = 0
    const monday = new Date(today);
    monday.setDate(today.getDate() - weekday);
    return {
      type: 'dateRange',
      from: localDayKey(monday),
      to: localDayKey(today),
      phrase: 'на этой неделе',
      rawText
    };
  }

  // 3. Match catch-up (recent)
  const recentRegex = /(?:^|[^а-яёА-ЯЁa-zA-Z0-9])(что\s+было|напомни|что\s+у\s+меня|что\s+я\s+писал|что\s+происходит|кратко\s+что\s+было)(?![а-яёА-ЯЁa-zA-Z0-9])/i;
  if (recentRegex.test(lowerText)) {
    return { type: 'recent', rawText };
  }

  return { type: 'none', rawText };
}
