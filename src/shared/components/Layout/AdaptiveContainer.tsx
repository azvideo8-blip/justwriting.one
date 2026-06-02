import React from 'react';
import { cn } from '../../../shared/utils/cn';

interface AdaptiveContainerProps {
  children: React.ReactNode;
  maxWidth?: number;
  widthPercent?: number;
  className?: string;
}

export function AdaptiveContainer({ children, maxWidth, widthPercent, className }: AdaptiveContainerProps) {
  const containerStyle = {
    maxWidth: widthPercent && widthPercent < 100 ? `${widthPercent}%` : (maxWidth != null && maxWidth > 0 ? `${maxWidth}px` : '100%'),
  };
  return (
    <div
      className={cn("mx-auto w-full px-4", className)}
      style={containerStyle}
    >
      {children}
    </div>
  );
}
