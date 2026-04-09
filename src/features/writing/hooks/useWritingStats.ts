import { useState, useEffect, useCallback, useRef } from 'react';

export function useWritingStats(content: string, seconds: number, initialWordCount: number, sessionType: string, wordGoal: number) {
  const [wpm, setWpm] = useState(0);
  const [wordGoalReached, setWordGoalReached] = useState(false);
  
  const currentWords = content.trim().split(/\s+/).filter(x => x.length > 0).length;
  const wordCount = currentWords - initialWordCount;
  
  // Buffer for sliding window: { timestamp: number, wordCount: number }
  const buffer = useRef<{ timestamp: number, wordCount: number }[]>([]);
  const lastUpdate = useRef(0);

  useEffect(() => {
    if (lastUpdate.current === 0) {
      lastUpdate.current = Date.now();
    }
  }, []);

  // Эффект 1: считаем WPM и проверяем цель
  useEffect(() => {
    const now = Date.now();
    const timeSinceLastSample = now - lastUpdate.current;

    // Сэмплируем максимум раз в 5 секунд при изменении контента
    if (timeSinceLastSample >= 5000) {
      buffer.current.push({ timestamp: now, wordCount: currentWords });
      lastUpdate.current = now;
      buffer.current = buffer.current.filter(h => now - h.timestamp <= 60000);
    }

    if (buffer.current.length > 1) {
      const first = buffer.current[0];
      const last = buffer.current[buffer.current.length - 1];
      const durationSeconds = (last.timestamp - first.timestamp) / 1000;
      if (durationSeconds > 0) {
        const calculatedWpm = Math.round(
          ((last.wordCount - first.wordCount) / durationSeconds) * 60
        );
        setWpm(Math.max(0, calculatedWpm));
      }
    }

    if (sessionType === 'words' && wordCount >= wordGoal) {
      setWordGoalReached(true);
    }
  }, [currentWords, wordCount, sessionType, wordGoal]);

  // Эффект 2: плавное затухание WPM каждые 10 секунд при бездействии
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      // Если пользователь не писал > 30 секунд — начинаем decay
      if (now - lastUpdate.current > 30000) {
        setWpm(prev => Math.max(0, prev - 2));
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []); // запускается один раз

  const resetStats = useCallback(() => {
    setWpm(0);
    setWordGoalReached(false);
    buffer.current = [];
  }, []);

  return { wordCount, wpm, wordGoalReached, setWordGoalReached, resetStats };
}
