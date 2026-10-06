// SECURITY: the one injection pattern list — re-exported to api/ (api/ai/pure.ts)
// and to the client (src/features/ai/shared/). Do NOT add patterns anywhere
// else. (The old functions/ copy was deleted with Firebase.)

// Patterns written for Latin-script phrases. Checked against a homoglyph-
// folded copy of the input (see foldLatinHomoglyphs below) so that visually
// identical Cyrillic/Greek lookalikes (e.g. Cyrillic "i" in "ignore previous")
// don't bypass them.
const LATIN_PATTERNS = [
  /ignore\s+previous/i,
  /ignore\s+instructions/i,
  /jailbreak/i,
  /(?<=^|[^а-яёА-ЯЁa-zA-Z0-9])DAN(?=$|[^а-яёА-ЯЁa-zA-Z0-9])/i,
  // X-2: только инструктивные формы. «you are now the only one who understands
  // me» — страница дневника, а не попытка перепрограммировать модель: объект
  // службы (mode/assistant/DAN/unrestricted…) должен стоять в пределах фразы.
  /you\s+are\s+now[^.!?\n]{0,40}\b(mode|assistant|ai|bot|chatbot|model|dan|unrestricted|uncensored|unfiltered|jailbroken|evil|free\s+of|ignore|no\s+(rules|limits|restrictions)|without\s+restrictions|programmed\s+to|designed\s+to\s+ignore)\b/i,
  /forget\s+your/i,
  /(^|\n)\s*s[yi]stem\s*:/i,
  /as\s+an\s+AI(?=$|[^а-яёА-ЯЁa-zA-Z0-9])/i,
  /(^|\n)\s*developer\s*:/i,
  /<\|im_start\|>/i,
  /\[INST\]/i,
  /<developer>/i,
  /<end_of_turn>/i,
  // Промежуток ограничен длиной: с открытым `.*` движок перебирает позиции
  // квадратично, и 50 000 пробелов после «repeat» занимают процесс на секунду.
  /repeat\s+.{0,200}(s[yi]stem|initial)\s+prompt/i,
  /output\s+your\s+instructions/i,
  /reveal\s+your\s+s[yi]stem\s+prompt/i,
];

// Patterns written for Cyrillic/Russian phrases. Checked against the
// ORIGINAL (non-folded) text — folding to Latin would break these, since
// they need to match real Cyrillic letters.
const CYRILLIC_PATTERNS = [
  /новые\s+инструкции/i,
  // X-2: «забудь» само по себе — бытовая форма дневника («забудь всё, что я
  // писал, и начни заново»). Оно становится инъекцией только с объектом из
  // служебного слоя: инструкции, правила, настройки, системный промпт, роль.
  // Запятая после «всё» разрывает соседство глагола с объектом, поэтому
  // «забудь всё, что я писал» остаётся записью, а не атакой.
  /забудь\s+(вс[её]|все|свои|своих|предыдущ(?:ие|их)|прежн(?:ие|их)|люб(?:ые|ых)|эти)?\s*((все|свои|их|предыдущие|эти)\s+)?(инструкц|правил|условий|рамк|настройк|указани|ограничени|запрет|цензур|сообщени)/i,
  /забудь\s+(системн|промпт|роль)/i,
  // Ревью X-2: «забудь всё выше», «забудь всё, что тебе сказали», «забудь всё и
  // следуй новым правилам» — обращены к модели, не к дневнику («что я писал»).
  /забудь\s+вс[её]\s*(выше|сказанное|,?\s*что\s+(тебе|тебя|ты)|и\s+(следуй|отвечай|действуй|веди|будь|стань|притворись))/i,
  /игнорируй\s+предыдущие\s+инструкц/i,
  /выведи\s+.{0,200}(системный|свой)\s+промпт/i,
  /покажи\s+.{0,200}(системный\s+промпт|свои\s+инструкции)/i,
  /напиши\s+свои\s+системные\s+инструкции/i,
];


import { classifyInvisibleCodePoint } from './buildChatPrompt.js';

// Flat list kept for compatibility with any lingering direct reference.
export const INJECTION_PATTERNS = [...LATIN_PATTERNS, ...CYRILLIC_PATTERNS];

// Нормализуем невидимые символы перед проверкой инъекций.
// Символы категории 'space' (U+2000..U+200A, U+2028, U+2029 и т.д.) заменяются на U+0020,
// чтобы сохранить границу слова для паттернов с \s+.
// S-15: Проверяются оба варианта (drop удалён и drop → пробел), чтобы невидимый
// символ не мог служить разделителем слов в обход проверки.
function stripInvisible(text: string, dropMode: 'delete' | 'space' = 'delete'): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const action = classifyInvisibleCodePoint(code);
    if (action === 'space') {
      out += ' ';
    } else if (action === 'keep') {
      out += ch;
    } else if (action === 'drop' && dropMode === 'space') {
      out += ' ';
    }
  }
  return out;
}

// Cyrillic/Greek letters visually identical to a Latin letter in most fonts —
// used to spoof a Latin-script phrase (jailbreak, ignore previous, etc.) past
// a regex expecting real Latin letters. Deliberately a small, explicit map
// (not a general Unicode confusables table) — covers only letters that could
// plausibly stand in for a letter appearing in LATIN_PATTERNS above. These are
// ordinary printable Cyrillic letters (not invisible characters) — fine to
// type as normal literal characters, unlike ZERO_WIDTH_CODE_POINTS above.
const HOMOGLYPH_MAP: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
  'х': 'x', 'у': 'y', 'і': 'i', 'ѕ': 's', 'һ': 'h',
  'м': 'm', 'т': 't', 'к': 'k', 'ү': 'y',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M',
  'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T',
  'Х': 'X', 'У': 'Y',
  // Greek lookalikes (the comment above always claimed Greek coverage; these were
  // missing, so a Greek-omicron "ignore previous" bypassed every LATIN_PATTERN).
  '\u03BF': 'o', '\u03B1': 'a', '\u03B9': 'i', '\u03BD': 'v', '\u03C1': 'p', '\u03C5': 'u', '\u03BA': 'k', '\u03C4': 't',
  '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0397': 'H', '\u0399': 'I', '\u039A': 'K', '\u039C': 'M',
  '\u039D': 'N', '\u039F': 'O', '\u03A1': 'P', '\u03A4': 'T', '\u03A5': 'Y', '\u03A7': 'X',
};

function foldLatinHomoglyphs(text: string): string {
  let out = '';
  for (const ch of text) {
    out += HOMOGLYPH_MAP[ch] ?? ch;
  }
  return out;
}

function checkInjectionVariant(text: string, dropMode: 'delete' | 'space'): boolean {
  const stripped = stripInvisible(text, dropMode);
  const latinFolded = foldLatinHomoglyphs(stripped);
  return LATIN_PATTERNS.some(p => p.test(latinFolded)) || CYRILLIC_PATTERNS.some(p => p.test(stripped));
}

export function hasInjectionAttempt(text: string): boolean {
  // S-15: Проверяем оба режима нормализации невидимых символов
  return checkInjectionVariant(text, 'delete') || checkInjectionVariant(text, 'space');
}
