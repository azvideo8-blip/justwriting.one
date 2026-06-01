import { type TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../shared/utils/cn';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  helperText?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, helperText, className, ...props }, ref) => (
    <div className="w-full">
      <textarea
        ref={ref}
        className={cn(
          'w-full px-3 py-2 rounded-xl border bg-surface-elevated text-text-main placeholder:text-text-subtle/50 resize-y min-h-[80px]',
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

Textarea.displayName = 'Textarea';
