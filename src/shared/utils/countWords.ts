export function countWords(text: string): number {
  if (!text) return 0;
  // Match sequences of letters/digits (including Unicode) or words with internal apostrophes/hyphens
  const matches = text.match(/[\p{L}\p{N}]+(?:[-'\p{L}\p{N}]*[\p{L}\p{N}]+)?/gu);
  return matches ? matches.length : 0;
}
