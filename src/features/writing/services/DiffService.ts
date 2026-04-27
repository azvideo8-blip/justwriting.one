export function computeWordDiff(oldContent: string, newContent: string): {
  wordsAdded: number;
  charsAdded: number;
} {
  const oldWords = oldContent.trim().split(/\s+/).filter(Boolean).length;
  const newWords = newContent.trim().split(/\s+/).filter(Boolean).length;
  return {
    wordsAdded: newWords - oldWords,
    charsAdded: newContent.length - oldContent.length,
  };
}
