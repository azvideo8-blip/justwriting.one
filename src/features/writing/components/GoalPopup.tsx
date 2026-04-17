import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../../core/utils/utils';

interface GoalPopupProps {
  open: boolean;
  onClose: () => void;
  title: string;
  presets: { value: number; label: string }[];
  current: number;
  onSelect: (val: number) => void;
  onClear: () => void;
  placeholder: string;
  inputUnit?: string;
}

export function GoalPopup({
  open,
  onClose,
  title,
  presets,
  current,
  onSelect,
  onClear,
  placeholder
}: GoalPopupProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.95 }}
          className="absolute top-full mt-2 left-0 z-50 bg-surface-card border border-border-subtle rounded-2xl p-3 shadow-lg w-[180px]"
        >
          <div className="text-[11px] text-text-main/40 mb-2">{title}</div>
          <div className="flex gap-1 flex-wrap mb-2">
            {presets.map(p => (
              <button
                key={p.value}
                onClick={() => { onSelect(p.value); onClose(); }}
                className={cn(
                  "px-2 py-1 rounded-lg text-xs border transition-all",
                  current === p.value
                    ? "border-text-main bg-text-main text-surface-base"
                    : "border-border-subtle text-text-main/60 hover:text-text-main"
                )}
              >{p.label}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder={placeholder}
              defaultValue={current || ''}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = parseInt((e.target as HTMLInputElement).value);
                  if (val > 0) { onSelect(val); onClose(); }
                }
                if (e.key === 'Escape') onClose();
              }}
              className="flex-1 bg-surface-base border border-border-subtle rounded-xl px-2 py-1.5 text-sm text-text-main outline-none"
              autoFocus={true}
            />
            {current > 0 && (
              <button
                onClick={() => { onClear(); onClose(); }}
                className="text-xs text-text-main/40 hover:text-text-main/70"
              >✕</button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
