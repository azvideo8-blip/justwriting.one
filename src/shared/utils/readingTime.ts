export function readingTimeMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 190));
}
