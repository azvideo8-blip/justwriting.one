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
  // MQ-12: цель нажатия 48×44, а дорожка 48×24 внутри неё; -my-2.5 возвращает строке прежнюю
  // высоту, так что раскладка не меняется — меняется только зона касания.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "-my-2.5 flex h-11 w-12 shrink-0 items-center",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <span
        className={cn(
          "w-12 h-6 rounded-full p-1 transition-colors duration-200 flex items-center",
          checked ? "bg-text-main" : "bg-text-main/20",
        )}
      >
        <motion.span
          animate={{ x: checked ? 24 : 0 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
          className={cn(
            "w-4 h-4 rounded-full shadow-sm",
            checked ? "bg-surface-base" : "bg-text-main/70"
          )}
        />
      </span>
    </button>
  );
}
