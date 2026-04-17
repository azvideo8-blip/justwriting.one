import React from 'react';
import { cn } from '../../core/utils/utils';

interface LoadingSpinnerProps {
  size?: number;
}

const sizeMap: Record<number, string> = {
  4: 'w-4 h-4',
  5: 'w-5 h-5',
  6: 'w-6 h-6',
  8: 'w-8 h-8',
  10: 'w-10 h-10',
  12: 'w-12 h-12',
  16: 'w-16 h-16',
};

export function LoadingSpinner({ size = 10 }: LoadingSpinnerProps) {
  return (
    <div 
      className={cn(
        "border-4 rounded-full animate-spin border-surface-base/10 border-t-text-main",
        sizeMap[size] ?? 'w-10 h-10'
      )} 
    />
  );
}
