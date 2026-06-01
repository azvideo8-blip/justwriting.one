import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../shared/utils/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error, helperText, className, ...props }, ref) => (
    <div className="w-full">
      <input
        ref={ref}
        className={cn(
          'w-full px-3 py-2 rounded-xl border bg-surface-elevated text-text-main placeholder:text-text-subtle/50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50',
          'disabled:opacity-50',
          error
            ? 'border-accent-danger focus-visible:ring-accent-danger/50'
            : 'border-border-subtle',
          className,
        )}
        aria-invalid={!!error}
        {...props}
      />
      {error && (
        <p className="mt-1 text-xs text-accent-danger" role="alert">{error}</p>
      )}
      {helperText && !error && (
        <p className="mt-1 text-xs text-text-subtle">{helperText}</p>
      )}
    </div>
  )
);

Input.displayName = 'Input';
