// THERAPY-2: Conservative crisis risk detector.
// Catches ONLY explicit acute risk markers (suicidal intent, plan, self-harm).
// Does NOT trigger on normal heavy reflection (sadness, fatigue, "всё плохо").

const RISK_PATTERNS: RegExp[] = [
  // Explicit suicidal intent
  /хочу\s+(умереть|покончить|убить\s+себя)/i,
  /покончить\s+с\s+собой/i,
  /суицид/i,
  /самоубийств/i,
  /не\s+хочу\s+жить/i,
  /нет\s+смысла\s+жить/i,
  /лучше\s+бы\s+(я\s+)?(умер|погиб|не\s+родился)/i,
  /думал.*\s+(о\s+смерти|убить\s+себя|покончить)/i,
  // Plan / means
  /как\s+(убить\s+себя|покончить|умереть)/i,
  /(таблетк|нож|веревк|оруж|яд|выброс\w*с\w*окн|выпрыгн|крыша|поезд|утоп).*\s+(собой|себя|умереть|покончить)/i,
  // Self-harm intent
  /хочу\s+(порезать|навредить|причинить\s+боль)\s+(себе|себя)/i,
  /режу\s+себя/i,
  /самоповрежд/i,
  /наказать\s+себя.*\s+(физическ|боль|травм)/i,
  // Goodbye / finality
  /прощайте|прощай\s+всем|это\s+моё\s+последнее/i,
  /никто\s+не\s+заметит.*(если|когда).*\s+(меня\s+не\s+будет|я\s+умру)/i,
];

// False-positive suppressors: these phrases nearby mean it's NOT acute
const SAFE_CONTEXT = [
  'не хочу', 'не думал', 'не планирую', 'раньше думал', 'была мысль но',
  'не буду', 'справляюсь', 'преодол', 'прошло', 'в прошлом',
];

export interface RiskResult {
  isRisk: boolean;
  severity: 'none' | 'possible' | 'acute';
  matchedPattern?: string;
}

// Исключение считается, только если оно не лежит целиком внутри найденной
// фразы: «не хочу» внутри «не хочу жить» гасило сам риск. Перекрытие с началом
// фразы — законное отрицание («я не думал о смерти»: «не » до неё, «думал» в ней).
function hasSafeContextAround(lower: string, start: number, end: number): boolean {
  const from = Math.max(0, start - 40);
  const to = end + 40;
  for (const safe of SAFE_CONTEXT) {
    for (let i = lower.indexOf(safe, from); i !== -1 && i + safe.length <= to; i = lower.indexOf(safe, i + 1)) {
      const insideMatch = i >= start && i + safe.length <= end;
      if (!insideMatch) return true;
    }
  }
  return false;
}

export function detectRisk(text: string): RiskResult {
  const lower = text.toLowerCase();

  for (const pattern of RISK_PATTERNS) {
    const match = pattern.exec(lower);
    if (match) {
      if (hasSafeContextAround(lower, match.index, match.index + match[0].length)) {
        return { isRisk: false, severity: 'none' };
      }
      return { isRisk: true, severity: 'acute', matchedPattern: match[0] };
    }
  }

  return { isRisk: false, severity: 'none' };
}
