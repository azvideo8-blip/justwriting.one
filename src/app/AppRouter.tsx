import { motion, useReducedMotion } from 'motion/react';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { AnimatedRoutes } from './AnimatedRoutes';

export function AppRouter() {
  const { loading } = useAuthStatus();
  const reducedMotion = useReducedMotion();

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-surface-base">
      <motion.div
        animate={reducedMotion ? {} : { scale: [1, 1.1, 1] }}
        transition={reducedMotion ? undefined : { repeat: Infinity, duration: 2 }}
        className="text-text-main/40 text-2xl"
      >
        justwriting.one...
      </motion.div>
    </div>
  );

  return <AnimatedRoutes />;
}
