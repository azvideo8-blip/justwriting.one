import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../core/utils/utils';

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'brand';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-text-main text-surface-base hover:opacity-90',
  ghost: 'text-text-main/50 hover:text-text-main hover:bg-text-main/8',
  danger: 'text-accent-danger border border-accent-danger/30 hover:bg-accent-danger/10',
  brand: 'bg-brand-primary text-bg-base hover:brightness-110',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-lg',
  md: 'px-4 py-2 text-sm rounded-xl',
  lg: 'px-6 py-2.5 text-base rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'ghost', size = 'md', className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        'font-medium transition-colors disabled:opacity-50',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    />
  )
);

Button.displayName = 'Button';
