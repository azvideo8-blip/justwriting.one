export function countWords(text: string): number {
  if (!text) return 0;
  // CJK characters (Chinese, Japanese, Korean) are conventionally one word each.
  // Match CJK chars individually, then match non-CJK word runs.
  const cjkMatches = text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/gu);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  // Remove CJK chars so they don't get double-counted as part of \p{L} runs
  const nonCjkText = text.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/gu, ' ');
  // Типографский апостроф (’, ʼ) — как ASCII ': автозамена превращает «don't» в
  // «don’t», и раньше это считалось двумя словами (DA-21).
  const wordMatches = nonCjkText.match(/[\p{L}\p{N}]+(?:[-'\u2019\u02BC\p{L}\p{N}]*[\p{L}\p{N}]+)?/gu);
  const wordCount = wordMatches ? wordMatches.length : 0;
  return cjkCount + wordCount;
}
