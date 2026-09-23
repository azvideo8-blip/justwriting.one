/**
 * Checks whether a title is blank (null, undefined, empty, or consists exclusively of
 * Unicode format characters \p{Cf}, zero-width spaces, directional controls, and whitespace).
 * Does NOT mutate the title, preserving valid multi-codepoint sequences such as
 * compound emojis (👨‍👩‍👧, 👩‍💻, 🏳️‍🌈) and international scripts (Persian/Arabic ZWNJ).
 */
export function isBlankTitle(title?: string | null): boolean {
  if (!title) return true;
  return title.replace(/[\p{Cf}\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, '').trim() === '';
}

/**
 * Backward-compatible helper: returns trimmed title if not blank, otherwise empty string.
 * Does not strip \p{Cf} from valid titles.
 */
export function normalizeTitle(title?: string | null): string {
  if (isBlankTitle(title)) return '';
  return title!.trim();
}
