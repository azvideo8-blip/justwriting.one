export interface TemporalQuery {
  type: 'month' | 'dateRange' | 'recent' | 'person' | 'none';
  month?: string;        // YYYY-MM if type=month
  from?: string;         // YYYY-MM-DD if type=dateRange
  to?: string;
  personName?: string;   // if type=person
  rawText: string;
}

const MONTHS_MAP: Record<string, string> = {
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

function lemmatizeRussianName(name: string): string {
  let n = name.trim();
  if (!n) return '';
  n = n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();

  if (n.endsWith('шу')) return n.slice(0, -2) + 'ша';
  if (n.endsWith('е')) {
    if (n.endsWith('ее')) return n.slice(0, -2) + 'ей'; // Сергее -> Сергей
    if (n.endsWith('ие')) return n.slice(0, -2) + 'ий'; // Дмитрие -> Дмитрий
    if (n.endsWith('ье')) return n.slice(0, -2) + 'ья'; // Илье -> Илья
    return n.slice(0, -1) + 'а'; // Диме -> Дима, Маше -> Маша, Саше -> Саша
  }
  if (n.endsWith('шей') || n.endsWith('шой')) return n.slice(0, -3) + 'ша';
  if (n.endsWith('ой')) {
    return n.slice(0, -2) + 'а'; // Светой -> Света
  }
  if (n.endsWith('ей')) {
    return n.slice(0, -2) + 'я'; // Таней -> Таня
  }
  if (n.endsWith('ою') || n.endsWith('ею')) {
    return n.slice(0, -2) + 'а';
  }
  if (n.endsWith('у')) {
    if (n.endsWith('ю')) return n.slice(0, -1) + 'я'; // Таню -> Таня
    return n.slice(0, -1) + 'а'; // Свету -> Света
  }
  if (n.endsWith('ом') || n.endsWith('ем')) {
    if (n.endsWith('еем')) return n.slice(0, -3) + 'ей';
    if (n.endsWith('ием')) return n.slice(0, -3) + 'ий';
    return n.slice(0, -2); // Иваном -> Иван
  }
  return n;
}

export function parseTemporalQuery(text: string): TemporalQuery {
  const rawText = text;
  const lowerText = text.toLowerCase().trim();

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
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
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
      to: toDate.toISOString().slice(0, 10),
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
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      rawText
    };
  }

  // 3. Match person mention: "про Наташу", "о Диме", "с Сашей"
  const personRegex = /(?:^|[^а-яёА-ЯЁa-zA-Z0-9])(?:про|о|обо|с|со|у)\s+([а-яёА-ЯЁa-zA-Z]+)(?![а-яёА-ЯЁa-zA-Z0-9])/i;
  const personMatch = rawText.match(personRegex);
  if (personMatch) {
    const rawName = personMatch[1]!;
    // Filter out common prepositions or non-names if matched mistakenly
    const nonNames = ['меня', 'тебя', 'нем', 'ней', 'них', 'себе', 'ком', 'чем', 'что', 'том', 'этом', 'нас', 'вас', 'всех', 'всём'];
    if (!nonNames.includes(rawName.toLowerCase())) {
      const name = lemmatizeRussianName(rawName);
      if (name && name.length >= 2) {
        return {
          type: 'person',
          personName: name,
          rawText
        };
      }
    }
  }

  // 4. Match catch-up (recent)
  const recentRegex = /(?:^|[^а-яёА-ЯЁa-zA-Z0-9])(что\s+было|напомни|что\s+у\s+меня|что\s+я\s+писал|что\s+происходит|кратко\s+что\s+было)(?![а-яёА-ЯЁa-zA-Z0-9])/i;
  if (recentRegex.test(lowerText)) {
    return { type: 'recent', rawText };
  }

  return { type: 'none', rawText };
}
