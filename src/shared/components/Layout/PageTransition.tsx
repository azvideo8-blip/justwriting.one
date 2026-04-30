import React from 'react';
import { motion } from 'motion/react';

interface PageTransitionProps {
  children: React.ReactNode;
  id: string;
}

export function PageTransition({ children, id }: PageTransitionProps) {
  return (
    <motion.div
      key={id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  );
}
