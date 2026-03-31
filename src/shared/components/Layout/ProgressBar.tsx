import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../../core/utils/utils';

interface ProgressBarProps {
  status: 'idle' | 'writing' | 'paused' | 'finished';
  sessionType: 'stopwatch' | 'timer' | 'words' | 'finish-by';
  wordCount: number;
  wordGoal: number;
  seconds: number;
  timerDuration: number;
  totalDurationForDeadline: number | null;
  wordGoalReached: boolean;
  timeGoalReached: boolean;
  isV2: boolean;
  isZenActive: boolean;
  zenModeEnabled: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  status, sessionType, wordCount, wordGoal, seconds, timerDuration, totalDurationForDeadline,
  wordGoalReached, timeGoalReached, isV2, isZenActive, zenModeEnabled
}) => {
  if (status !== 'writing' || (sessionType !== 'words' && sessionType !== 'timer' && sessionType !== 'finish-by')) {
    return null;
  }

  return (
    <div className={cn(
      "fixed left-0 w-full h-1.5 transition-all duration-1000",
      isZenActive && zenModeEnabled ? "top-0" : "top-16",
      isV2 ? "bg-white/5" : "bg-stone-100 dark:bg-stone-800",
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
            ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" 
            : (isV2 ? "bg-emerald-400" : "bg-stone-900 dark:bg-stone-100")
        )}
      />
    </div>
  );
};
