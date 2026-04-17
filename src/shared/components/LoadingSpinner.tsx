import React from 'react';
import { cn } from '../../core/utils/utils';

interface LoadingSpinnerProps {
  size?: number;
}

/**
 * Shared LoadingSpinner component for consistent waiting states.
 * @param size Tailwind size units (e.g., 10 for w-10 h-10).
 */
export function LoadingSpinner({ size = 10 }: LoadingSpinnerProps) {
  // Use square brackets for dynamic layout values if JIT is enabled, 
  // or just rely on common sizes. For simplicity and following the request:
  return (
    <div 
      className={cn(
        "border-4 rounded-full animate-spin border-surface-base/10 border-t-text-main",
        size === 10 ? "w-10 h-10" : size === 8 ? "w-8 h-8" : size === 6 ? "w-6 h-6" : size === 5 ? "w-5 h-5" : `w-${size} h-${size}`
      )} 
    />
  );
}
