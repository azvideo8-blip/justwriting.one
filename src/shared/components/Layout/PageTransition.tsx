import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

interface PageTransitionProps {
  children: React.ReactNode;
  id: string;
}

export function PageTransition({ children, id }: PageTransitionProps) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      key={id}
      initial={reducedMotion ? {} : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.15, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  );
}
