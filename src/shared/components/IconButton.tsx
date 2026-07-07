import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';
import { cn } from '../../shared/utils/cn';

type IconButtonSize = 'sm' | 'md';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  size?: IconButtonSize;
  active?: boolean;
}

const sizeStyles: Record<IconButtonSize, string> = {
  sm: 'w-8 h-8',
  md: 'w-9 h-9',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, size = 'md', active, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        'rounded-xl flex items-center justify-center transition-colors clickable-target-expansion',
        sizeStyles[size],
        active
          ? 'bg-text-main/10 text-text-main'
          : 'text-text-main/60 hover:text-text-main hover:bg-text-main/5',
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  )
);

IconButton.displayName = 'IconButton';
