import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../../shared/utils/cn';

interface ToggleProps {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel: string;
}

export function Toggle({ checked, onChange, disabled, className, ariaLabel }: ToggleProps) {
  const reducedMotion = useReducedMotion();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "w-12 h-6 rounded-full p-1 transition-colors duration-300 flex items-center shrink-0",
        checked ? "bg-text-main" : "bg-white/20",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <motion.div
        animate={{ x: checked ? 24 : 0 }}
        transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 30 }}
        className={cn(
          "w-4 h-4 rounded-full shadow-sm",
          checked ? "bg-surface-base" : "bg-white"
        )}
      />
    </button>
  );
}
