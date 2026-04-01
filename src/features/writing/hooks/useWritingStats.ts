import { useState, useEffect, useCallback, useRef } from 'react';

export function useWritingStats(content: string, seconds: number, initialWordCount: number, sessionType: string, wordGoal: number) {
  const [wordCount, setWordCount] = useState(0);
  const [wpm, setWpm] = useState(0);
  const [wordGoalReached, setWordGoalReached] = useState(false);
  
  // Buffer for sliding window: { timestamp: number, wordCount: number }
  const buffer = useRef<{ timestamp: number, wordCount: number }[]>([]);
  const lastUpdate = useRef(Date.now());

  useEffect(() => {
    const currentWords = content.trim().split(/\s+/).filter(x => x.length > 0).length;
    const sessionWords = currentWords - initialWordCount;
    setWordCount(sessionWords);
    
    const now = Date.now();
    
    // Sample every 5 seconds
    if (now - lastUpdate.current >= 5000) {
      buffer.current.push({ timestamp: now, wordCount: currentWords });
      lastUpdate.current = now;
      
      // Keep only last 60s
      buffer.current = buffer.current.filter(h => now - h.timestamp <= 60000);
    }

    // WPM Calculation
    if (buffer.current.length > 1) {
      const first = buffer.current[0];
      const last = buffer.current[buffer.current.length - 1];
      const durationSeconds = (last.timestamp - first.timestamp) / 1000;
      
      if (durationSeconds > 0) {
        const calculatedWpm = Math.round(((last.wordCount - first.wordCount) / durationSeconds) * 60);
        setWpm(calculatedWpm);
      }
    } else {
      // Decay logic: if no activity, decay WPM
      if (now - lastUpdate.current > 5000) {
        setWpm(prev => Math.max(0, prev - 1));
      }
    }

    if (sessionType === 'words' && sessionWords >= wordGoal) {
      setWordGoalReached(true);
    }
  }, [content, seconds, sessionType, wordGoal, initialWordCount]);

  const resetStats = useCallback(() => {
    setWordCount(0);
    setWpm(0);
    setWordGoalReached(false);
    buffer.current = [];
  }, []);

  return { wordCount, wpm, wordGoalReached, setWordGoalReached, resetStats };
}
