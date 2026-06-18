import { useTimerStore } from '../store/useTimerStore';
import { useContentStore } from '../store/useContentStore';
import { formatTime } from '../../../core/utils/formatTime';

interface TimerDisplayProps {
  showZen: boolean;
}

export function TimerDisplay({ showZen }: TimerDisplayProps) {
  const seconds = useTimerStore(s => s.seconds);
  const sessionType = useTimerStore(s => s.sessionType);
  const wordGoal = useTimerStore(s => s.wordGoal);
  const wordCount = useContentStore(s => s.wordCount);
  const wordGoalReached = useTimerStore(s => s.wordGoalReached);

  return (
    <div className={showZen ? 'text-text-main/60' : ''}>
      <span className="font-mono text-2xl tabular-nums">{formatTime(seconds)}</span>
      {sessionType === 'words' && (
        <span className="text-sm text-text-main/60 ml-2">
          {wordCount}/{wordGoal} {wordGoalReached && '✓'}
        </span>
      )}
    </div>
  );
}
