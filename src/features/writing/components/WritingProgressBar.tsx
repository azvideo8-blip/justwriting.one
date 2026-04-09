import React, { useEffect, useRef } from 'react';
import { useWritingStore } from '../../../features/writing/store/useWritingStore';
import { ProgressBar } from '../../../shared/components/Layout/ProgressBar';
import { useWritingSettings } from '../../../features/writing/contexts/WritingSettingsContext';
import { useUI } from '../../../contexts/UIContext';

export const WritingProgressBar: React.FC = () => {
  const { uiVersion } = useUI();
  const { isZenActive, zenModeEnabled } = useWritingSettings();
  const isV2 = uiVersion === '2.0';

  const status = useWritingStore(s => s.status);
  const sessionType = useWritingStore(s => s.sessionType);
  const wordCount = useWritingStore(s => s.wordCount);
  const wordGoal = useWritingStore(s => s.wordGoal);
  const seconds = useWritingStore(s => s.seconds);
  const timerDuration = useWritingStore(s => s.timerDuration);
  const wordGoalReached = useWritingStore(s => s.wordGoalReached);
  const timeGoalReached = useWritingStore(s => s.timeGoalReached);
  const targetTime = useWritingStore(s => s.targetTime);

  const sessionStartTime = useWritingStore(s => s.sessionStartTime);

  const totalDurationForDeadline = React.useMemo(() => {
    if (status === 'writing' && sessionType === 'finish-by' && targetTime && sessionStartTime) {
      const [hours, minutes] = targetTime.split(':').map(Number);
      const target = new Date(sessionStartTime);
      target.setHours(hours, minutes, 0, 0);
      
      // If the target time is before the session start time, assume it's for the next day
      if (target.getTime() < sessionStartTime) {
        target.setDate(target.getDate() + 1);
      }
      
      return (target.getTime() - sessionStartTime) / 1000;
    }
    return null;
  }, [status, sessionType, targetTime, sessionStartTime]);

  return (
    <ProgressBar
      status={status}
      sessionType={sessionType}
      wordCount={wordCount}
      wordGoal={wordGoal}
      seconds={seconds}
      timerDuration={timerDuration}
      totalDurationForDeadline={totalDurationForDeadline}
      wordGoalReached={wordGoalReached}
      timeGoalReached={timeGoalReached}
      isV2={isV2}
      isZenActive={isZenActive}
      zenModeEnabled={zenModeEnabled}
    />
  );
};
