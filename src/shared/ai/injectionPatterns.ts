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
  /\bDAN\b/i,
  /you\s+are\s+now/i,
  /forget\s+your/i,
  /(^|\n)\s*system\s*:/i,
  /as\s+an\s+AI\b/i,
  /(^|\n)\s*developer\s*:/i,
  /<\|im_start\|>/i,
  /\[INST\]/i,
  /<developer>/i,
  /<end_of_turn>/i,
  /repeat\s+.*(system|initial)\s+prompt/i,
  /output\s+your\s+instructions/i,
  /reveal\s+your\s+system\s+prompt/i,
];

// Patterns written for Cyrillic/Russian phrases. Checked against the
// ORIGINAL (non-folded) text — folding to Latin would break these, since
// they need to match real Cyrillic letters.
const CYRILLIC_PATTERNS = [
  /новые\s+инструкции/i,
  /забудь\s+(вс[её]|свои|преды|инструк)/i,
  /выведи\s+.*(системный|свой)\s+промпт/i,
  /покажи\s+.*(системный\s+промпт|свои\s+инструкции)/i,
  /напиши\s+свои\s+системные\s+инструкции/i,
];


// Flat list kept for compatibility with any lingering direct reference.
export const INJECTION_PATTERNS = [...LATIN_PATTERNS, ...CYRILLIC_PATTERNS];

// Zero-width/invisible Unicode code points an attacker can splice into a
// phrase to dodge a regex without changing how the text visibly renders.
// Expressed as numeric code points on purpose (not a regex literal, not a
// \u-escape string) — see the unicode note at the top of this prompt.
const ZERO_WIDTH_CODE_POINTS = new Set<number>([
  0x200B, 0x200C, 0x200D, 0xFEFF, 0x00AD, // zero-width space/joiners, BOM, soft hyphen
  0x2028, 0x2029, 0x202F, 0x205F,          // line/paragraph separators, narrow/medium math space
]);
function isInvisibleCodePoint(code: number): boolean {
  return ZERO_WIDTH_CODE_POINTS.has(code) || (code >= 0x2000 && code <= 0x200A); // general punctuation space block
}
function stripInvisible(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (!isInvisibleCodePoint(code)) out += ch;
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
