import React from 'react';
import { cn } from '../../../core/utils/utils';
import { LAYOUT_CONSTRAINTS } from '../../lib/layoutRegistry';

interface AdaptiveContainerProps {
  children: React.ReactNode;
  size?: keyof typeof LAYOUT_CONSTRAINTS;
  className?: string;
}

export function AdaptiveContainer({ children, size = 'WIDE', className }: AdaptiveContainerProps) {
  return (
    <div className={cn(LAYOUT_CONSTRAINTS[size], className)}>
      {children}
    </div>
  );
}
