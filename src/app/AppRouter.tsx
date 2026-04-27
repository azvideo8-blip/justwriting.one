import { motion } from 'motion/react';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { AnimatedRoutes } from './AnimatedRoutes';

export function AppRouter() {
  const { loading } = useAuthStatus();

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-surface-base">
      <motion.div
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ repeat: Infinity, duration: 2 }}
        className="text-text-main/40 text-2xl"
      >
        justwriting.one...
      </motion.div>
    </div>
  );

  return <AnimatedRoutes />;
}
