import { motion, useReducedMotion } from 'motion/react';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { AnimatedRoutes } from './AnimatedRoutes';
import { JustWritingLogo } from '../shared/components/JustWritingLogo';
import { useLanguage } from '../shared/i18n';

export function AppRouter() {
  const { loading } = useAuthStatus();
  const reducedMotion = useReducedMotion();
  const { t } = useLanguage();

  if (loading) return (
    <div className="h-screen w-screen flex flex-col items-center justify-center gap-8 bg-surface-base">
      <motion.div
        animate={reducedMotion ? {} : { opacity: [0.7, 1, 0.7] }}
        {...(reducedMotion ? {} : { transition: { repeat: Infinity, duration: 3, ease: "easeInOut" } })}
        className="drop-shadow-[0_0_24px_color-mix(in_srgb,var(--brand-soft)_40%,transparent)]"
      >
        <JustWritingLogo size={160} variant="dark" showRailway={true} showRoman={true} showCrown={true} />
      </motion.div>

      <motion.p
        initial={reducedMotion ? {} : { opacity: 0 }}
        animate={{ opacity: 1 }}
        {...(reducedMotion ? {} : { transition: { delay: 0.4, duration: 0.8 } })}
        className="text-sm text-text-main/60 tracking-widest uppercase font-sans"
      >
        {t("common_loading")}
      </motion.p>
    </div>
  );

  return <AnimatedRoutes />;
}
