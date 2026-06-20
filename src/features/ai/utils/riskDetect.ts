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

export function detectRisk(text: string): RiskResult {
  const lower = text.toLowerCase();

  for (const pattern of RISK_PATTERNS) {
    const match = pattern.exec(lower);
    if (match) {
      // Check for false-positive context
      const context = lower.slice(Math.max(0, match.index! - 40), match.index! + match[0].length + 40);
      const hasSafeContext = SAFE_CONTEXT.some(s => context.includes(s));
      if (hasSafeContext) {
        return { isRisk: false, severity: 'none' };
      }
      return { isRisk: true, severity: 'acute', matchedPattern: match[0] };
    }
  }

  return { isRisk: false, severity: 'none' };
}

// THERAPY-2: Crisis resources (РФ)
export const CRISIS_RESOURCES = [
  'Телефон доверия (бесплатно, круглосуточно): 8-800-2000-122 — для детей, подростков и их родителей',
  'Московская служба психологической помощи населению: 051 (с мобильного: +7 495 051)',
  'Телефон доверия emergencies: 112',
  'Горячая линия по вопросам суицида: 8-800-333-44-34',
];

export const SAFETY_GUIDE = `БЕЗОПАСНОСТЬ (кризисный протокол):
— Если пользователь выражает явные суицидальные намерения, план самоповреждения или прощается — это абсолютный приоритет.
— ТЕПЛО признай его боль: «Я слышу, как тяжело. Ты важен, и то, что ты чувствуешь — реально.»
— БЕЗ clinических предписаний, БЕЗ холодного отказа, БЕЗ обрыва диалога.
— Бережно направь к живой помощи: «Пожалуйста, позвони сейчас — ты не один» + телефоны доверия.
— Не уходи от темы, не меняй тему на «что хорошего случилось».
— Спутник для рефлексии — не замена терапевта. При остром риске — направление к человеку.`;
