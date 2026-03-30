import { useState, useEffect } from 'react';

export function useWritingStats(content: string, seconds: number, initialWordCount: number, sessionType: string, wordGoal: number) {
  const [wordCount, setWordCount] = useState(0);
  const [wpm, setWpm] = useState(0);
  const [wordGoalReached, setWordGoalReached] = useState(false);

  useEffect(() => {
    const words = content.trim().split(/\s+/).filter(x => x.length > 0).length;
    setWordCount(words);
    if (seconds > 0) {
      const sessionWords = Math.max(0, words - initialWordCount);
      setWpm(Math.round((sessionWords / seconds) * 60));
    }
    if (sessionType === 'words' && (words - initialWordCount) >= wordGoal) {
      setWordGoalReached(true);
    }
  }, [content, seconds, sessionType, wordGoal, initialWordCount]);

  const resetStats = () => {
    setWordCount(0);
    setWpm(0);
    setWordGoalReached(false);
  };

  return { wordCount, wpm, wordGoalReached, setWordGoalReached, resetStats };
}
