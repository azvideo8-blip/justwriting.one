// SECURITY: Shared injection pattern list — imported by both api/chat.ts
// (Vercel Edge) and functions/src/shared/aiUtils.ts (Cloud Functions).
// Do NOT add patterns locally in either file — update this file only.
// (functions/src/shared/aiUtils.ts keeps an independent copy for now, kept in
// sync manually — see the comment there.)

// Patterns written for Latin-script phrases. Checked against a homoglyph-
// folded copy of the input (see foldLatinHomoglyphs below) so that visually
// identical Cyrillic/Greek lookalikes (e.g. Cyrillic "i" in "ignore previous")
// don't bypass them.
const LATIN_PATTERNS = [
  /ignore\s+previous/i,
  /ignore\s+instructions/i,
  /jailbreak/i,
  /(?<=^|[^а-яёА-ЯЁa-zA-Z0-9])DAN(?=$|[^а-яёА-ЯЁa-zA-Z0-9])/i,
  /you\s+are\s+now/i,
  /forget\s+your/i,
  /(^|\n)\s*system\s*:/i,
  /as\s+an\s+AI(?=$|[^а-яёА-ЯЁa-zA-Z0-9])/i,
  /(^|\n)\s*developer\s*:/i,
  /<\|im_start\|>/i,
  /\[INST\]/i,
  /<developer>/i,
  /<end_of_turn>/i,
  // Промежуток ограничен длиной: с открытым `.*` движок перебирает позиции
  // квадратично, и 50 000 пробелов после «repeat» занимают процесс на секунду.
  /repeat\s+.{0,200}(system|initial)\s+prompt/i,
  /output\s+your\s+instructions/i,
  /reveal\s+your\s+system\s+prompt/i,
];

// Patterns written for Cyrillic/Russian phrases. Checked against the
// ORIGINAL (non-folded) text — folding to Latin would break these, since
// they need to match real Cyrillic letters.
const CYRILLIC_PATTERNS = [
  /новые\s+инструкции/i,
  /забудь\s+(вс[её]|свои|преды|инструк)/i,
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
// Символы категории 'drop' (нулевая ширина, U+2060, U+FE0F, теги U+E0000..E007F) удаляются.
function stripInvisible(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const action = classifyInvisibleCodePoint(code);
    if (action === 'space') {
      out += ' ';
    } else if (action === 'keep') {
      out += ch;
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
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M',
  'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T',
  'Х': 'X', 'У': 'Y',
  // Greek lookalikes (the comment above always claimed Greek coverage; these were
  // missing, so a Greek-omicron "ignore previous" bypassed every LATIN_PATTERN).
  'ο': 'o', 'α': 'a', 'ι': 'i', 'ν': 'v', 'ρ': 'p', 'υ': 'u', 'κ': 'k', 'τ': 't',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M',
  'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
};

function foldLatinHomoglyphs(text: string): string {
  let out = '';
  for (const ch of text) {
    out += HOMOGLYPH_MAP[ch] ?? ch;
  }
  return out;
}

export function hasInjectionAttempt(text: string): boolean {
  const stripped = stripInvisible(text);
  const latinFolded = foldLatinHomoglyphs(stripped);
  return LATIN_PATTERNS.some(p => p.test(latinFolded)) || CYRILLIC_PATTERNS.some(p => p.test(stripped));
}
