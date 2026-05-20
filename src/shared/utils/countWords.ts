export function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const isSpace = text.charCodeAt(i) <= 32;
    if (inWord && isSpace) {
      count++;
      inWord = false;
    } else if (!inWord && !isSpace) {
      inWord = true;
    }
  }
  if (inWord) count++;
  return count;
}
