export function computeWordDiff(oldContent: string, newContent: string): {
  wordsAdded: number;
  charsAdded: number;
} {
  const oldWords = oldContent.trim().split(/\s+/).filter(Boolean).length;
  const newWords = newContent.trim().split(/\s+/).filter(Boolean).length;
  return {
    wordsAdded: Math.max(0, newWords - oldWords),
    charsAdded: Math.max(0, newContent.length - oldContent.length),
  };
}
