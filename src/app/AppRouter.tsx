import { motion, useReducedMotion } from 'motion/react';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { AnimatedRoutes } from './AnimatedRoutes';
import { JustWritingLogo } from '../shared/components/JustWritingLogo';
import { useLanguage } from '../core/i18n';

export function AppRouter() {
  const { loading } = useAuthStatus();
  const reducedMotion = useReducedMotion();
  const { t } = useLanguage();

  if (loading) return (
    <div className="h-screen w-screen flex flex-col items-center justify-center gap-8 bg-surface-base">
      <motion.div
        animate={reducedMotion ? {} : { scale: [1, 1.04, 1], opacity: [0.85, 1, 0.85] }}
        transition={reducedMotion ? undefined : { repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
      >
        <div
          className="w-24 h-24 rounded-3xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, var(--brand-soft), var(--brand-deep))' }}
        >
          <JustWritingLogo size={72} variant="white" showRailway={false} showRoman={false} showCrown={false} />
        </div>
      </motion.div>

      <motion.p
        initial={reducedMotion ? {} : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reducedMotion ? undefined : { delay: 0.3, duration: 0.6 }}
        className="text-sm text-text-main/35 tracking-widest uppercase font-sans"
      >
        {t('common_loading')}
      </motion.p>
    </div>
  );

  return <AnimatedRoutes />;
}
