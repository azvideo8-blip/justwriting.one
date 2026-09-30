// THERAPY-2: Conservative crisis risk detector.
// Catches ONLY explicit acute risk markers (suicidal intent, plan, self-harm).
// Does NOT trigger on normal heavy reflection (sadness, fatigue, "всё плохо").

import { classifyInvisibleCodePoint, CONFUSABLES_MAP, foldConfusables } from '../../../shared/ai/buildChatPrompt';

// Текст сравнивается после normalize(): нижний регистр, ё→е, без невидимых
// символов — поэтому в паттернах только «е».
const RISK_PATTERNS: RegExp[] = [
  // Explicit suicidal intent
  /хочу\s+(умереть|покончить|убить\s+себя)/,
  /покончить\s+с\s+собой/,
  /суицид/,
  /самоубийств/,
  /не\s+хочу\s+жить/,
  /нет\s+смысла\s+(дальше\s+)?жить/,
  /лучше\s+бы\s+(я\s+)?(умер|погиб|не\s+родился)/,
  /думал.*\s+(о\s+смерти|убить\s+себя|покончить)/,
  // Plan / means. Средства — целыми словами: «яд» сидит внутри «порядок», «наряд».
  // Средство и цель — в одной клаузе: без класса-границы «таблетки» из «врач
  // выписал таблетки, чтобы не умереть» дотягивался через запятую до «умереть».
  /(?:^|[^а-я])(таблетк|нож|веревк|оруж|яд(?![а-я])|выброс\w*с\w*окн|выпрыгн|крыш|поезд|утоп)[^.,;:!?\n—–]*\s+(собой|себя|умереть|покончить)/,
  // Self-harm intent
  /хочу\s+(порезать|навредить|причинить\s+боль)\s+(себе|себя)/,
  /режу\s+себя/,
  /самоповрежд/,
  /наказать\s+себя.*\s+(физическ|боль|травм)/,
  // Goodbye / finality
  /прощайте|прощай\s+всем|это\s+мое\s+последнее/,
  /никто\s+не\s+заметит.*(если|когда).*\s+(меня\s+не\s+будет|я\s+умру)/,
];

// L-1: короткие списки EN и транслита. Совпадают с латинским вариантом текста
// (кириллица сложена в латиницу), а не с кириллическим.
const FOREIGN_RISK_PATTERNS: RegExp[] = [
  // English
  /i\s+want\s+to\s+(die|kill\s+myself|end\s+my\s+life)/,
  /kill\s+myself/,
  /suicid(?:e|al)/,
  // Translit
  /ne\s+hochu\s+zhit/,
  /hochu\s+umeret/,
  /pokonchit\s+s\s+soboj/,
  /net\s+smysla\s+(dalshe\s+)?zhit/,
];

// Инверсия CONFUSABLES_MAP (кириллица→латиница): латинская буква-двойник
// складывается в кириллицу. Дубликаты («А»→A и «а»→a) разрешаются в пользу
// первой записи; греческие двойники не годятся — паттерны кириллические.
const LATIN_LOOKALIKE_TO_CYRILLIC: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [cyr, lat] of Object.entries(CONFUSABLES_MAP)) {
    const code = cyr.codePointAt(0) ?? 0;
    if (code >= 0x370 && code < 0x400) continue;
    const low = lat.toLowerCase();
    if (!(low in map)) map[low] = cyr.toLowerCase();
  }
  return map;
})();

function foldLatinLookalikes(text: string): string {
  let out = '';
  for (const ch of text) out += LATIN_LOOKALIKE_TO_CYRILLIC[ch] ?? ch;
  return out;
}

// False-positive suppressors: these phrases in the same clause mean it's NOT acute
const SAFE_CONTEXT = [
  'не хочу', 'не думал', 'не планирую', 'раньше думал', 'была мысль но',
  'не буду', 'справляюсь', 'преодол', 'прошло', 'в прошлом', 'не про меня',
];

// Граница клаузы: знак препинания или союз-поворот. Исключение из соседней
// клаузы («не думал о смерти, но хочу покончить с собой») острое не гасит.
const CLAUSE_BREAK = /[.,;:!?\n—–]|\s(?:но|а|однако)\s/g;

export interface RiskResult {
  isRisk: boolean;
  severity: 'none' | 'acute';
  matchedPattern?: string;
}

const LETTER_RE = /[\p{L}\p{N}]/u;

function baseNormalize(text: string): string {
  const chars = Array.from(text);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const action = classifyInvisibleCodePoint(ch.codePointAt(0) ?? 0);
    if (action === 'space') out += ' ';
    else if (action === 'keep') out += ch;
    // «drop»-символ между двумя буквами склеивал слова: «нехочужить» без
    // пробелов после выбрасывания нулевой ширины уходил мимо всех паттернов.
    else if (LETTER_RE.test(chars[i - 1] ?? '') && LETTER_RE.test(chars[i + 1] ?? '')) out += ' ';
  }
  return out.toLowerCase().replace(/ё/g, 'е');
}

function clauseBounds(lower: string, start: number, end: number): [number, number] {
  let from = 0;
  let to = lower.length;
  for (const m of lower.matchAll(CLAUSE_BREAK)) {
    const at = m.index;
    if (at + m[0].length <= start) from = at + m[0].length;
    else if (at >= end) { to = at; break; }
  }
  return [from, to];
}

// Исключение считается, только если оно в той же клаузе и не лежит целиком
// внутри найденной фразы: «не хочу» внутри «не хочу жить» гасило сам риск.
// Перекрытие с началом фразы — законное отрицание («я не думал о смерти»).
function hasSafeContextAround(lower: string, start: number, end: number): boolean {
  const [from, to] = clauseBounds(lower, start, end);
  for (const safe of SAFE_CONTEXT) {
    for (let i = lower.indexOf(safe, from); i !== -1 && i + safe.length <= to; i = lower.indexOf(safe, i + 1)) {
      const insideMatch = i >= start && i + safe.length <= end;
      if (!insideMatch) return true;
    }
  }
  return false;
}

function firstAcuteMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
      if (!hasSafeContextAround(text, match.index, match.index + match[0].length)) {
        return match[0];
      }
    }
  }
  return null;
}

export function detectRisk(text: string): RiskResult {
  const lower = baseNormalize(text);

  // Все совпадения всех паттернов: исключение у ранней фразы («раньше думал
  // о смерти») не должно прятать острую позже («а сейчас режу себя»).
  // Кириллические паттерны — против латинских букв-двойников; EN/транслит —
  // против кириллицы, сложенной в латиницу.
  const cyr = foldLatinLookalikes(lower);
  const cyrMatch = firstAcuteMatch(cyr, RISK_PATTERNS);
  if (cyrMatch) return { isRisk: true, severity: 'acute', matchedPattern: cyrMatch };
  const latMatch = firstAcuteMatch(foldConfusables(lower), FOREIGN_RISK_PATTERNS);
  if (latMatch) return { isRisk: true, severity: 'acute', matchedPattern: latMatch };

  return { isRisk: false, severity: 'none' };
}
