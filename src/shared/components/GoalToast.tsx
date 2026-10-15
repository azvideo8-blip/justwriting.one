import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../../shared/i18n';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { cn } from '../utils/cn';

interface GoalToastProps {
  visible: boolean;
  type: 'time' | 'words' | null;
}

export function GoalToast({ visible, type }: GoalToastProps) {
  const { t } = useLanguage();
  const reducedMotion = useReducedMotion();
  const mobile = useLayoutMode().layoutMode === 'mobile';

  return (
    <AnimatePresence>
      {visible && type && (
        <motion.div
          // MQ-15 (N-12): то же движение и та же позиция, что у Toast: сдвиг 12 px, 220 мс вход / 150 мс уход,
          // на телефоне — над нижней панелью с отступом safe-area и перенос текста вместо nowrap на 360 px.
          initial={reducedMotion ? {} : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6, transition: { duration: 0.15 } }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          className={cn(
            'fixed z-[var(--z-skip)] pointer-events-none',
            mobile
              ? 'left-4 right-4 flex justify-center bottom-[calc(env(safe-area-inset-bottom,0px)+var(--bottom-nav-height,56px)+12px)]'
              : 'bottom-24 left-1/2 -translate-x-1/2',
          )}
        >
          <div role="status" aria-live="polite" className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-surface-card border border-border-subtle backdrop-blur-xl shadow-lg">
            <CheckCircle2 size={18} className="text-accent-success shrink-0" />
            <span className={cn('text-sm font-medium text-text-main', !mobile && 'whitespace-nowrap')}>
              {type === 'time' ? t('goal_reached_time') : t('goal_reached_words')}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
