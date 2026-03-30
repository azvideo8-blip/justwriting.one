import { useState, useEffect } from 'react';
import { useTimer } from './useTimer';

export function useWritingTimer(sessionType: 'stopwatch' | 'timer' | 'words' | 'finish-by', timerDuration: number, targetTime: string | null) {
  const { seconds, status, setStatus, timeGoalReached, setTimeGoalReached, resetTimer } = useTimer(sessionType, timerDuration, targetTime);
  
  return { seconds, status, setStatus, timeGoalReached, setTimeGoalReached, resetTimer };
}
