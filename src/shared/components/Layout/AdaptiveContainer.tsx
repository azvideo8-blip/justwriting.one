import React from 'react';
import { cn } from '../../../core/utils/utils';

interface AdaptiveContainerProps {
  children: React.ReactNode;
  maxWidth?: number;
  className?: string;
}

export function AdaptiveContainer({ children, maxWidth, className }: AdaptiveContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full px-4", className)}
      style={{ maxWidth: maxWidth ? `${maxWidth}px` : '100%' }}
    >
      {children}
    </div>
  );
}
