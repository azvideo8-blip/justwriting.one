// FN-1: запись, на которую текст опирается («на сессии 10.10»), сходство векторов
// не различает — на живой базе соседние дневниковые записи все 0,7–0,8, и нужная
// сессия была 53-й (DG-2). Дни, названные в тексте, находит код: абсолютные даты
// и относительные от даты приложенной заметки (не от часов прибора).

// DR-3: модель переворачивает порядок и расстояние дат — запись, написанную ДО
// приложенной, называет написанной после (кейс 5), трёхдневную зовёт «неделю
// назад» (кейс 7). Обе даты знает код, поэтому метку считает он. Считается по
// локальным календарным суткам: суточное окно у пользователя ночное, и разница в
// мс или UTC-сутки путают «в тот же день» с «через день».
export function localDay(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

const DAY = 86_400_000;
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const NUM_WORDS: Record<string, number> = { один: 1, два: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7 };
// Индекс — день недели JS (0 = воскресенье).
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'сред[уа]', 'четверг', 'пятниц[уа]', 'суббот[уа]'];

function ymd(y: number, m: number, d: number): number | null {
  const t = Date.UTC(y, m - 1, d);
  const c = new Date(t);
  return c.getUTCMonth() === m - 1 && c.getUTCDate() === d ? t : null;
}

// Год не назван — та же дата в году заметки, не позже дня заметки. Позже — прошлый
// год, но только недалёкий: «как 20.12» в январской заметке — прошлый декабрь (C8),
// а «в отпуск 25.12» в октябрьской — план, не прошлый декабрь (R-12).
const PREV_YEAR_WINDOW_DAYS = 92;
function withoutYear(m: number, d: number, noteDay: number | null): number | null {
  if (noteDay === null) return null;
  const y = new Date(noteDay).getUTCFullYear();
  const t = ymd(y, m, d);
  if (t !== null && t <= noteDay) return t;
  const prev = ymd(y - 1, m, d);
  return prev !== null && noteDay - prev <= PREV_YEAR_WINDOW_DAYS * DAY ? prev : null;
}

// R-12: «в 7.10», «к 9.30», «до 18.00», «с 10.15», «около 8.05» — время, не дата
// (с годом — дата: «в 10.10.2026»). «версия 1.10», «v1.10» — номер версии.
const TIME_PREPOSITION_RE = /(?:^|[^а-яёa-z])(?:в|к|до|с|около)\s*$/;
const VERSION_RE = /(?:^|[^а-яёa-z])(?:верси[яию]|v|ver\.?)\s*$/;
// R-12: «3.05 кг», «15.06 руб», «2.10 ₽» — число с единицей или валютой следом.
const UNIT_AFTER_RE = /^\s*(?:кг|км|см|мм|мл|рубл[а-яё]*|руб|р\.|₽|\$|€|тыс|млн|млрд|%)(?![а-яёa-z])/;
// C8: «с 01.10 по 05.10» — диапазон дат, не время; одиночное «с 8.10» — время.
// Хвост — тоже дата (день 1–31, месяц 1–12): «с 8.10 по 9.40» — время.
const RANGE_TAIL_RE = /^\s*по\s+(?:0?[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])(?![\d])/;

/** Локальные сутки (как `localDay`), названные в тексте заметки. */
export function referencedDays(text: string, noteAt: number | undefined): Set<number> {
  const out = new Set<number>();
  const add = (t: number | null) => { if (t !== null) out.add(t); };
  const noteDay = noteAt ? localDay(noteAt) : null;
  // Шапки блоков `[#id · 2026-10-10]` — даты самих приложенных, не ссылки.
  const s = text.replace(/\[#[^\]]*\]/g, ' ').toLowerCase();

  for (const m of s.matchAll(/(?<![\d.])(\d{4})-(\d{2})-(\d{2})(?![\d])/g)) add(ymd(+m[1]!, +m[2]!, +m[3]!));
  // Месяц — двумя цифрами: «1.5 часа» не дата. «10.30» отсекает проверка месяца.
  for (const m of s.matchAll(/(?<![\d.])(\d{1,2})\.(\d{2})(?:\.(\d{4}|\d{2}))?(?![\d]|\.\d)/g)) {
    const [d, mo, y] = [+m[1]!, +m[2]!, m[3]];
    const before = s.slice(0, m.index);
    if (VERSION_RE.test(before) || UNIT_AFTER_RE.test(s.slice(m.index! + m[0].length))) continue;
    if (!y && TIME_PREPOSITION_RE.test(before) && !RANGE_TAIL_RE.test(s.slice(m.index! + m[0].length))) continue;
    add(y ? ymd(y.length === 2 ? 2000 + +y : +y, mo, d) : withoutYear(mo, d, noteDay));
  }
  for (const m of s.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${MONTHS.join('|')})(?:\\s+(\\d{4}))?`, 'g'))) {
    const [d, mo, y] = [+m[1]!, MONTHS.indexOf(m[2]!) + 1, m[3]];
    add(y ? ymd(+y, mo, d) : withoutYear(mo, d, noteDay));
  }

  if (noteDay === null) return out;
  if (/(?<![а-яё])позавчера/.test(s)) out.add(noteDay - 2 * DAY);
  if (/(?<![а-яё])вчера/.test(s)) out.add(noteDay - DAY);
  for (const m of s.matchAll(/(?<![а-яё\d])(\d{1,2}|один|два|три|четыре|пять|шесть|семь)\s+(?:день|дня|дней)\s+назад/g)) {
    const n = NUM_WORDS[m[1]!] ?? +m[1]!;
    if (n > 0) out.add(noteDay - n * DAY);
  }
  // «В прошлый вторник» — вторник прошлой календарной недели (неделя с понедельника):
  // вторник этой недели назвали бы «во вторник» или «вчера».
  const weekday = new Date(noteDay).getUTCDay();
  const thisMonday = noteDay - ((weekday + 6) % 7) * DAY;
  WEEKDAYS.forEach((name, wd) => {
    if (new RegExp(`прошл(?:ый|ую|ое)\\s+${name}`).test(s)) out.add(thisMonday - 7 * DAY + ((wd + 6) % 7) * DAY);
  });
  return out;
}
