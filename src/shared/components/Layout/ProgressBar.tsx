import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../../core/utils/utils';

import { useWritingStore } from '../../../features/writing/store/useWritingStore';

interface ProgressBarProps {
  totalDurationForDeadline: number | null;
  isZenActive: boolean;
  zenModeEnabled: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  totalDurationForDeadline, isZenActive, zenModeEnabled
}) => {
  const status = useWritingStore(s => s.status);
  const sessionType = useWritingStore(s => s.sessionType);
  const wordCount = useWritingStore(s => s.wordCount);
  const wordGoal = useWritingStore(s => s.wordGoal);
  const seconds = useWritingStore(s => s.seconds);
  const timerDuration = useWritingStore(s => s.timerDuration);
  const wordGoalReached = useWritingStore(s => s.wordGoalReached);
  const timeGoalReached = useWritingStore(s => s.timeGoalReached);

  if (status !== 'writing' || (sessionType !== 'words' && sessionType !== 'timer' && sessionType !== 'finish-by')) {
    return null;
  }

  return (
    <div className={cn(
      "fixed left-0 w-full h-1.5 transition-all duration-1000 bg-surface-card border-b border-border-subtle",
      isZenActive && zenModeEnabled ? "top-0" : "top-16",
      isZenActive && zenModeEnabled ? "opacity-100" : "opacity-100"
    )} style={{ zIndex: 100 }}>
      <motion.div
        initial={{ width: 0 }}
        animate={{
          width: sessionType === 'words'
            ? `${Math.min((wordCount / wordGoal) * 100, 100)}%`
            : `${Math.min(((sessionType === 'timer' ? seconds / timerDuration : seconds / (totalDurationForDeadline || 1)) * 100), 100)}%`
        }}
        className={cn(
          "h-full transition-colors duration-500",
          (wordGoalReached || timeGoalReached) 
            ? "bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.8)]" 
            : "bg-text-main"
        )}
      />
    </div>
  );
};
