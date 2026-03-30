import { useState, useEffect, useRef } from 'react';

export type TimerStatus = 'idle' | 'writing' | 'paused' | 'finished';

export function useTimer(
  sessionType: 'stopwatch' | 'timer' | 'words' | 'finish-by',
  timerDuration: number,
  targetTime: string | null
) {
  const [seconds, setSeconds] = useState(0);
  const [status, setStatus] = useState<TimerStatus>('idle');
  const [timeGoalReached, setTimeGoalReached] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const pausedTimeRef = useRef<number>(0);

  useEffect(() => {
    let interval: any;
    if (status === 'writing') {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now() - pausedTimeRef.current * 1000;
      }
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current!) / 1000);
        setSeconds(elapsed);
        
        // Goal checks
        if (sessionType === 'timer' && elapsed >= timerDuration) {
          setTimeGoalReached(true);
        }
        if (sessionType === 'finish-by' && targetTime) {
          const [hours, minutes] = targetTime.split(':').map(Number);
          const now = new Date();
          const target = new Date();
          target.setHours(hours, minutes, 0, 0);
          if (now >= target) {
            setTimeGoalReached(true);
          }
        }
      }, 1000);
    } else {
      if (startTimeRef.current) {
        pausedTimeRef.current = Math.floor((Date.now() - startTimeRef.current) / 1000);
        startTimeRef.current = null;
      }
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [status, sessionType, timerDuration, targetTime]);

  const resetTimer = () => {
    setSeconds(0);
    setStatus('idle');
    setTimeGoalReached(false);
    startTimeRef.current = null;
    pausedTimeRef.current = 0;
  };

  return { seconds, status, setStatus, timeGoalReached, setTimeGoalReached, resetTimer };
}
