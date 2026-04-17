import React, { useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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
  triggerRef: React.RefObject<HTMLElement | null>;
}

export function GoalPopup({
  open,
  onClose,
  title,
  presets,
  current,
  onSelect,
  onClear,
  placeholder,
  triggerRef
}: GoalPopupProps) {
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (open && triggerRef.current) {
      const updatePosition = () => {
        if (triggerRef.current) {
          const rect = triggerRef.current.getBoundingClientRect();
          setCoords({
            top: rect.top - 8,
            left: rect.left
          });
        }
      };

      updatePosition();

      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }
  }, [open, triggerRef]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.95 }}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            transform: 'translateY(-100%)',
            zIndex: 9999,
          }}
          className="bg-surface-card border border-border-subtle rounded-2xl p-3 shadow-lg w-[180px]"
        >
          <div className="text-[11px] text-text-main/40 mb-2 font-bold uppercase tracking-widest">{title}</div>
          <div className="flex gap-1 flex-wrap mb-2">
            {presets.map(p => (
              <button
                key={p.value}
                onClick={() => { onSelect(p.value); onClose(); }}
                className={cn(
                  "px-2 py-1 rounded-lg text-xs border transition-all font-bold",
                  current === p.value
                    ? "border-text-main bg-text-main text-surface-base"
                    : "border-border-subtle text-text-main/60 hover:text-text-main hover:bg-white/5"
                )}
              >{p.label}</button>
            ))}
          </div>
          <div className="flex gap-2 items-center">
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
              className="flex-1 bg-surface-base border border-border-subtle rounded-xl px-2 py-1.5 text-sm text-text-main outline-none focus:border-text-main/40 w-16"
              autoFocus={true}
            />
            {current > 0 && (
              <button
                onClick={() => { onClear(); onClose(); }}
                className="text-xs text-text-main/40 hover:text-text-main/70 p-1"
              >✕</button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
