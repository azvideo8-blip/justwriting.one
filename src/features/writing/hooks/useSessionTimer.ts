import { useTimer } from './useTimer';
import { useWritingStats } from './useWritingStats';

export function useSessionTimer(
  sessionType: 'stopwatch' | 'timer' | 'words' | 'finish-by',
  timerDuration: number,
  targetTime: string | null,
  content: string,
  initialWordCount: number,
  wordGoal: number
) {
  const { seconds, status, setStatus, timeGoalReached, setTimeGoalReached, resetTimer } = useTimer(sessionType, timerDuration, targetTime);
  const { wordCount, wpm, wordGoalReached, setWordGoalReached, resetStats } = useWritingStats(content, seconds, initialWordCount, sessionType, wordGoal);

  return {
    seconds,
    status,
    setStatus,
    timeGoalReached,
    setTimeGoalReached,
    resetTimer,
    wordCount,
    wpm,
    wordGoalReached,
    setWordGoalReached,
    resetStats
  };
}
