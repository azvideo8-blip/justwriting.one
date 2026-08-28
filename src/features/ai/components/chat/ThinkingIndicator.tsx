import { useEffect, useState } from 'react';
import { useAIStageStore, AI_STAGE_LABEL } from '../../store/useAIStageStore';

// UXFIX-2: Animated activity indicator with seconds counter.
// Says what is actually happening. Most of the wait is spent searching notes and
// reading their summaries — the model is not involved yet — so a flat "думает…"
// was both wrong and uninformative on exactly the searches that take longest.
export function ThinkingIndicator({ name }: { name: string }) {
  const [seconds, setSeconds] = useState(0);
  const stage = useAIStageStore(s => s.stage);
  const activity = stage ? AI_STAGE_LABEL[stage] : 'готовит ответ';

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2 text-text-main/60" role="status" aria-live="polite">
      <span className="flex gap-1" aria-hidden="true">
        <span className="w-1.5 h-1.5 rounded-full bg-text-main/40 animate-pulse" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-text-main/40 animate-pulse" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-text-main/40 animate-pulse" style={{ animationDelay: '300ms' }} />
      </span>
      <span className="text-sm">{name} {activity}… {seconds}с</span>
    </div>
  );
}
