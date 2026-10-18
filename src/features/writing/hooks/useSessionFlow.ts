import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SessionType } from '../store/types';
import { DEFAULT_WORD_GOAL, useTimerStore } from '../store/useTimerStore';
import { SetupMode } from '../components/WritingSetup';
import { playGoalSound } from '../../../core/utils/sound';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';

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
  timeGoalReached: boolean,
  wordGoalReached: boolean
): UseSessionFlowReturn {
  const { layoutMode } = useLayoutMode();
  const [setupMode, setSetupMode] = useState<SetupMode>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [goalToastVisible, setGoalToastVisible] = useState(false);
  const [goalToastType, setGoalToastType] = useState<'time' | 'words' | null>(null);
  const [sessionStartFlash, setSessionStartFlash] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [totalDurationForDeadline, setTotalDurationForDeadline] = useState<number | null>(null);

  const countdownRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const goalFiredRef = useRef(false);

  const startCountdown = useCallback((type: SessionType) => {
    if (countdownRef.current !== undefined) clearInterval(countdownRef.current);
    setSessionType(type);
    // Q-11 (ревью 0.10.2): без выбранной цели «Слова» стартуют с 1000 — одно место
    // для десктопного и телефонного листа; открытие листа цель не сохраняет.
    if (type === 'words' && useTimerStore.getState().wordGoal <= 0) useTimerStore.getState().setWordGoal(DEFAULT_WORD_GOAL);
    
    if (layoutMode === 'mobile') {
      handleStart();
      setSetupMode(null);
      setCountdown(null);
      return;
    }

    setSetupMode('countdown');
    setCountdown(3);

    let count = 3;
    countdownRef.current = setInterval(() => {
      count -= 1;
      setCountdown(count);

      if (count === 0) {
        if (countdownRef.current !== undefined) clearInterval(countdownRef.current);
        handleStart();
        setTimeout(() => {
          setSetupMode(null);
          setCountdown(null);
        }, 800);
      }
    }, 1000);
  }, [setSessionType, handleStart, layoutMode]);

  const stableSetSetupMode = useCallback((mode: SetupMode) => {
    setSetupMode(mode);
  }, []);

  const stableSetShowCancelConfirm = useCallback((v: boolean) => {
    setShowCancelConfirm(v);
  }, []);

  useEffect(() => {
    if (sessionStatus === 'writing') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- НЕ производное: setSessionStartFlash гасится таймером через 800 мс. Значение живёт дольше рендера, вывести его на рендере нельзя
      setSessionStartFlash(true);
      const hideTimer = setTimeout(() => setSessionStartFlash(false), 800);
      return () => { clearTimeout(hideTimer); };
    }
  }, [sessionStatus]);

  useEffect(() => {
    const isGoalJustReached = (timeGoalReached || wordGoalReached) && !goalFiredRef.current;

    if (isGoalJustReached && sessionStatus === 'writing') {
      goalFiredRef.current = true;
      playGoalSound();
      const type = wordGoalReached ? 'words' : 'time';
      setGoalToastType(type);
      setGoalToastVisible(true);
      const hideTimer = setTimeout(() => setGoalToastVisible(false), 4000);
      return () => { clearTimeout(hideTimer); };
    }

    if (sessionStatus === 'idle') {
      goalFiredRef.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- НЕ производное: у setGoalToastVisible три писателя (показ по достижению цели, скрытие по таймеру, сброс здесь)
      setGoalToastVisible(false);
    }
  }, [timeGoalReached, wordGoalReached, sessionStatus]);

  const totalDurationRef = useRef<number | null>(null);

  useEffect(() => {
    if (sessionStatus === 'writing' && sessionType === 'finish-by' && targetTime) {
      if (totalDurationRef.current === null) {
        const parts = targetTime.split(':').map(Number);
        const hours = parts[0] ?? 0;
        const minutes = parts[1] ?? 0;
        const startEpoch = useTimerStore.getState().sessionStartEpochMs;
        const start = startEpoch ? new Date(startEpoch) : new Date();
        const target = new Date(start);
        target.setHours(hours, minutes, 0, 0);
        if (target <= start) {
          target.setDate(target.getDate() + 1);
        }
        const now = new Date();
        const remaining = Math.max(0, (target.getTime() - now.getTime()) / 1000);
        const dur = remaining + useTimerStore.getState().getElapsedSeconds();
        totalDurationRef.current = dur;
        setTotalDurationForDeadline(dur);
      }
    } else if (sessionStatus === 'idle') {
      totalDurationRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- НЕ производное: setTotalDurationForDeadline пишется и при старте сессии. Здесь сброс на null
      setTotalDurationForDeadline(null);
    }
  }, [sessionStatus, sessionType, targetTime]);

  useEffect(() => {
    return () => {
      if (countdownRef.current !== undefined) clearInterval(countdownRef.current);
    };
  }, []);

  return useMemo(() => ({
    setupMode, setSetupMode: stableSetSetupMode,
    countdown, startCountdown,
    goalToastVisible, goalToastType,
    sessionStartFlash,
    totalDurationForDeadline,
    showCancelConfirm, setShowCancelConfirm: stableSetShowCancelConfirm,
  }), [setupMode, stableSetSetupMode, countdown, startCountdown, goalToastVisible, goalToastType, sessionStartFlash, totalDurationForDeadline, showCancelConfirm, stableSetShowCancelConfirm]);
}
