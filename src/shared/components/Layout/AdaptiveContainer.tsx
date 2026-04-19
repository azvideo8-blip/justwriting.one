import React from 'react';
import { cn } from '../../../core/utils/utils';

interface AdaptiveContainerProps {
  children: React.ReactNode;
  maxWidth?: number;
  widthPercent?: number;
  className?: string;
}

export function AdaptiveContainer({ children, maxWidth, widthPercent, className }: AdaptiveContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full px-4", className)}
      style={{
        maxWidth: widthPercent && widthPercent < 100 ? `${widthPercent}%` : (maxWidth ? `${maxWidth}px` : '100%'),
      }}
    >
      {children}
    </div>
  );
}
