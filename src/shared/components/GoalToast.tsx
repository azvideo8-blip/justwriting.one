import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../../core/i18n';

interface GoalToastProps {
  visible: boolean;
  type: 'time' | 'words' | null;
}

export function GoalToast({ visible, type }: GoalToastProps) {
  const { t } = useLanguage();
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {visible && type && (
        <motion.div
          initial={reducedMotion ? {} : { opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.95 }}
          transition={reducedMotion ? { duration: 0 } : { type: 'spring', damping: 20, stiffness: 300 }}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[var(--z-skip)] pointer-events-none"
        >
          <div role="status" aria-live="polite" className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-surface-card border border-border-subtle backdrop-blur-xl shadow-lg">
            <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
            <span className="text-sm font-medium text-text-main whitespace-nowrap">
              {type === 'time' ? t('goal_reached_time') : t('goal_reached_words')}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
