import { type LabelHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../shared/utils/cn';

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ required, children, className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        'block text-sm font-medium text-text-main mb-1',
        className,
      )}
      {...props}
    >
      {children}
      {required && <span className="text-accent-danger ml-1" aria-hidden="true">*</span>}
    </label>
  )
);

Label.displayName = 'Label';
