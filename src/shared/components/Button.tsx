import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../shared/utils/cn';
import { LoadingSpinner } from './LoadingSpinner';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-text-main text-surface-base hover:opacity-90',
  secondary: 'bg-surface-elevated text-text-main border border-border-subtle hover:bg-surface-card',
  ghost: 'text-text-main/60 hover:text-text-main hover:bg-text-main/8',
  danger: 'text-accent-danger border border-accent-danger/30 hover:bg-accent-danger/10',
  brand: 'bg-brand-primary text-bg-base hover:brightness-110',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-lg',
  md: 'px-4 py-2 text-sm rounded-xl',
  lg: 'px-6 py-2.5 text-base rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'ghost', size = 'md', isLoading, disabled, children, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      disabled={disabled || isLoading}
      className={cn(
        'font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50 inline-flex items-center justify-center gap-2',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      {isLoading && <LoadingSpinner size={size === 'lg' ? 5 : 4} />}
      {children}
    </button>
  )
);

Button.displayName = 'Button';
