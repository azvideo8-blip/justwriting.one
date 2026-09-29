// THERAPY-2: Conservative crisis risk detector.
// Catches ONLY explicit acute risk markers (suicidal intent, plan, self-harm).
// Does NOT trigger on normal heavy reflection (sadness, fatigue, "всё плохо").

import { classifyInvisibleCodePoint } from '../../../shared/ai/buildChatPrompt';

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
  /как\s+(убить\s+себя|покончить|умереть)/,
  /(?:^|[^а-я])(таблетк|нож|веревк|оруж|яд(?![а-я])|выброс\w*с\w*окн|выпрыгн|крыш|поезд|утоп).*\s+(собой|себя|умереть|покончить)/,
  // Self-harm intent
  /хочу\s+(порезать|навредить|причинить\s+боль)\s+(себе|себя)/,
  /режу\s+себя/,
  /самоповрежд/,
  /наказать\s+себя.*\s+(физическ|боль|травм)/,
  // Goodbye / finality
  /прощайте|прощай\s+всем|это\s+мое\s+последнее/,
  /никто\s+не\s+заметит.*(если|когда).*\s+(меня\s+не\s+будет|я\s+умру)/,
];

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
  severity: 'none' | 'possible' | 'acute';
  matchedPattern?: string;
}

function normalize(text: string): string {
  let out = '';
  for (const ch of text) {
    const action = classifyInvisibleCodePoint(ch.codePointAt(0) ?? 0);
    if (action === 'space') out += ' ';
    else if (action === 'keep') out += ch;
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

export function detectRisk(text: string): RiskResult {
  const lower = normalize(text);

  // Все совпадения всех паттернов: исключение у ранней фразы («раньше думал
  // о смерти») не должно прятать острую позже («а сейчас режу себя»).
  for (const pattern of RISK_PATTERNS) {
    for (const match of lower.matchAll(new RegExp(pattern.source, 'g'))) {
      if (!hasSafeContextAround(lower, match.index, match.index + match[0].length)) {
        return { isRisk: true, severity: 'acute', matchedPattern: match[0] };
      }
    }
  }

  return { isRisk: false, severity: 'none' };
}
