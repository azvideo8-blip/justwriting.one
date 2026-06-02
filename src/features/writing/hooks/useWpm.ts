import { useEffect, useRef } from 'react';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';

export function applyWpmDecay() {
  const snapshots = useContentStore.getState().wordSnapshots;
  if (snapshots.length > 0) {
    const lastSnap = snapshots[snapshots.length - 1];
    const lastActive = lastSnap?.timestamp ?? Date.now();
    const idleSeconds = (Date.now() - lastActive) / 1000;
    if (idleSeconds > 5) {
      const currentWpm = useContentStore.getState().wpm;
      useContentStore.setState({ wpm: Math.max(0, Math.round(currentWpm * 0.95)) });
    }
  }
}

export function useWpm() {
  const wpm = useContentStore(s => s.wpm);
  const wpmHistory = useContentStore(s => s.wpmHistory);
  const status = useTimerStore(s => s.status);
  const decayRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (status === 'writing') {
      decayRef.current = setInterval(applyWpmDecay, 1000);
    } else {
      useContentStore.setState({ wpm: 0 });
    }
    return () => {
      if (decayRef.current) clearInterval(decayRef.current);
    };
  }, [status]);

  return { wpm, wpmHistory };
}
