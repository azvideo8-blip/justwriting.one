export interface LocalStyleMetrics {
  avgWordLength: number;
  avgSentenceLength: number;
  exclamationRate: number;
  questionRate: number;
  activeHours: number[];
}

export function analyzeWritingStyle(contents: string[]): LocalStyleMetrics {
  let totalWords = 0;
  let totalChars = 0;
  let totalSentences = 0;
  let exclamations = 0;
  let questions = 0;

  for (const text of contents) {
    const w = text.match(/[а-яёa-z0-9]+/gi) || [];
    totalWords += w.length;
    totalChars += w.reduce((s, word) => s + word.length, 0);

    const s = text.split(/[.!?]+/g).filter(Boolean);
    totalSentences += s.length;

    exclamations += (text.match(/!/g) || []).length;
    questions += (text.match(/\?/g) || []).length;
  }

  return {
    avgWordLength: totalWords ? totalChars / totalWords : 0,
    avgSentenceLength: totalSentences ? totalWords / totalSentences : 0,
    exclamationRate: totalSentences ? exclamations / totalSentences : 0,
    questionRate: totalSentences ? questions / totalSentences : 0,
    activeHours: [],
  };
}
