import { countWords } from '../../../shared/utils/countWords';

export function computeWordDelta(oldContent: string, newContent: string): {
  wordsAdded: number;
  charsAdded: number;
} {
  const oldWords = countWords(oldContent);
  const newWords = countWords(newContent);
  return {
    wordsAdded: Math.max(0, newWords - oldWords),
    charsAdded: Math.max(0, newContent.length - oldContent.length),
  };
}
