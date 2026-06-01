import React from 'react';
import { cn } from '../../shared/utils/cn';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated';
}

export function Card({ variant = 'default', className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border-subtle/50 bg-surface-card p-4',
        variant === 'elevated' && 'shadow-lg bg-surface-elevated',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
