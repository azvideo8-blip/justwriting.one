import { useState, useEffect, useCallback, useRef } from 'react';

export function useWritingStats(content: string, seconds: number, initialWordCount: number, sessionType: string, wordGoal: number) {
  const [wordCount, setWordCount] = useState(0);
  const [wpm, setWpm] = useState(0);
  const [wordGoalReached, setWordGoalReached] = useState(false);
  const history = useRef<{ timestamp: number, wordCount: number }[]>([]);
  const lastActivityTime = useRef(Date.now());

  useEffect(() => {
    const words = content.trim().split(/\s+/).filter(x => x.length > 0).length;
    setWordCount(words);
    
    const now = Date.now();
    if (words !== wordCount) {
      lastActivityTime.current = now;
      history.current.push({ timestamp: now, wordCount: words });
    }

    // Keep only last 30s
    history.current = history.current.filter(h => now - h.timestamp <= 30000);

    if (now - lastActivityTime.current > 10000) {
      // Pause in activity, keep last WPM or set to 0? Ticket says "do not poison average".
      // Let's keep last WPM if we have one, or 0.
    } else if (history.current.length > 1) {
      const first = history.current[0];
      const last = history.current[history.current.length - 1];
      const durationSeconds = (last.timestamp - first.timestamp) / 1000;
      if (durationSeconds > 0) {
        setWpm(Math.round(((last.wordCount - first.wordCount) / durationSeconds) * 60));
      }
    }

    if (sessionType === 'words' && (words - initialWordCount) >= wordGoal) {
      setWordGoalReached(true);
    }
  }, [content, seconds, sessionType, wordGoal, initialWordCount, wordCount]);

  const resetStats = useCallback(() => {
    setWordCount(0);
    setWpm(0);
    setWordGoalReached(false);
  }, []);

  return { wordCount, wpm, wordGoalReached, setWordGoalReached, resetStats };
}
