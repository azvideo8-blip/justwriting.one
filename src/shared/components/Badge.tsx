import React from 'react';
import { cn } from '../../shared/utils/cn';

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-surface-elevated text-text-main border-border-subtle',
  primary: 'bg-brand-primary/15 text-brand-primary border-brand-primary/20',
  success: 'bg-accent-success/15 text-accent-success border-accent-success/20',
  warning: 'bg-accent-warning/15 text-accent-warning border-accent-warning/20',
  danger: 'bg-accent-danger/15 text-accent-danger border-accent-danger/20',
};

export function Badge({ variant = 'default', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
