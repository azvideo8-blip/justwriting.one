import { useState, useEffect, useRef } from 'react';
import { SessionType } from '../store/useWritingStore';
import { SetupMode } from '../WritingSetup';
import { playGoalSound } from '../../../core/utils/sound';

interface UseSessionFlowReturn {
  setupMode: SetupMode;
  setSetupMode: (mode: SetupMode) => void;
  countdown: number | null;
  startCountdown: (type: SessionType) => void;
  goalToastVisible: boolean;
  goalToastType: 'time' | 'words' | null;
  sessionStartFlash: boolean;
  totalDurationForDeadline: number | null;
  showCancelConfirm: boolean;
  setShowCancelConfirm: (v: boolean) => void;
}

export function useSessionFlow(
  handleStart: () => void,
  sessionStatus: string,
  sessionType: SessionType,
  setSessionType: (type: SessionType) => void,
  targetTime: string | null,
  seconds: number,
  timeGoalReached: boolean,
  wordGoalReached: boolean,
  betaLifeLog?: boolean
): UseSessionFlowReturn {
  const [setupMode, setSetupMode] = useState<SetupMode>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [goalToastVisible, setGoalToastVisible] = useState(false);
  const [goalToastType, setGoalToastType] = useState<'time' | 'words' | null>(null);
  const [sessionStartFlash, setSessionStartFlash] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [totalDurationForDeadline, setTotalDurationForDeadline] = useState<number | null>(null);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const goalFiredRef = useRef(false);

  // Countdown logic
  const startCountdown = (type: SessionType) => {
    setSessionType(type);
    setSetupMode('countdown');
    setCountdown(3);

    let count = 3;
    countdownRef.current = setInterval(() => {
      count -= 1;
      setCountdown(count);

      if (count === 0) {
        clearInterval(countdownRef.current);
        handleStart();
        setTimeout(() => {
          setSetupMode(null);
          setCountdown(null);
        }, 800);
      }
    }, 1000);
  };

  // Session start flash
  useEffect(() => {
    if (sessionStatus === 'writing' && !betaLifeLog) {
      // eslint-disable-next-line
      setSessionStartFlash(true);
      setTimeout(() => setSessionStartFlash(false), 800);
    }
  }, [sessionStatus, betaLifeLog]);

  // Goal toast + sound
  useEffect(() => {
    const isGoalJustReached = (timeGoalReached || wordGoalReached) && !goalFiredRef.current;

    if (isGoalJustReached && sessionStatus === 'writing') {
      goalFiredRef.current = true;
      playGoalSound();
      const type = wordGoalReached ? 'words' : 'time';
      // eslint-disable-next-line
      setGoalToastType(type);
      setGoalToastVisible(true);
      setTimeout(() => setGoalToastVisible(false), 4000);
    }

    if (sessionStatus === 'idle') {
      goalFiredRef.current = false;
      setGoalToastVisible(false);
    }
  }, [timeGoalReached, wordGoalReached, sessionStatus]);

  // Deadline duration for finish-by progress bar
  useEffect(() => {
    if (sessionStatus === 'writing' && sessionType === 'finish-by' && targetTime) {
      if (totalDurationForDeadline === null) {
        const [hours, minutes] = targetTime.split(':').map(Number);
        const target = new Date();
        target.setHours(hours, minutes, 0, 0);
        const now = new Date();
        const remaining = Math.max(0, (target.getTime() - now.getTime()) / 1000);
        // eslint-disable-next-line
        setTotalDurationForDeadline(remaining + seconds);
      }
    } else if (sessionStatus === 'idle') {
      setTotalDurationForDeadline(null);
    }
  }, [sessionStatus, sessionType, targetTime, seconds, totalDurationForDeadline]);

  // Cleanup countdown on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  return {
    setupMode, setSetupMode,
    countdown, startCountdown,
    goalToastVisible, goalToastType,
    sessionStartFlash,
    totalDurationForDeadline,
    showCancelConfirm, setShowCancelConfirm,
  };
}
