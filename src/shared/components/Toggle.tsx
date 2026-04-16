import { motion } from 'motion/react';
import { cn } from '../../core/utils/utils';

interface ToggleProps {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Toggle({ checked, onChange, disabled, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
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
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className={cn(
          "w-4 h-4 rounded-full shadow-sm",
          checked ? "bg-surface-base" : "bg-white"
        )}
      />
    </button>
  );
}
