import React, { useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../../core/utils/utils';

interface GoalPopupProps {
  open: boolean;
  onClose: () => void;
  title: string;
  type?: 'words' | 'time';
  presets: { value: number; label: string }[];
  current: number;
  currentGoal?: number;
  onSelect: (val: number) => void;
  onClear: () => void;
  onClearLabel?: string;
  placeholder: string;
  triggerRef: React.RefObject<HTMLElement | null>;
  width?: string;
}

export function GoalPopup({
  open,
  onClose,
  title,
  type = 'words',
  presets,
  current,
  currentGoal,
  onSelect,
  onClear,
  onClearLabel = '✕',
  placeholder,
  triggerRef,
  width = 'w-[180px]'
}: GoalPopupProps) {
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (open && triggerRef.current) {
      const updatePosition = () => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        
        const POPUP_WIDTH = width === 'w-[210px]' ? 210 : 180;
        const POPUP_HEIGHT = 160;
        const GAP = 6;

        let top = Math.max(8, rect.top - POPUP_HEIGHT - GAP);
        let left = rect.left;

        if (left + POPUP_WIDTH > window.innerWidth - 8) {
          left = window.innerWidth - POPUP_WIDTH - 8;
        }
        if (left < 8) left = 8;

        setCoords({ top, left });
      };

      updatePosition();

      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }
  }, [open, triggerRef, width]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.95 }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            zIndex: 9999,
            background: '#111413',
          }}
          className={cn("border border-border-subtle rounded-lg p-3 shadow-xl", width)}
          data-goal-popup
        >
          <div className="text-[11px] text-text-main/40 mb-2 font-bold uppercase tracking-widest">{title}</div>
          <div className="flex gap-1 flex-wrap mb-2">
            {presets.map(p => {
              const isActive = type === 'time'
                ? Math.round(p.value / 60) === (currentGoal ?? current)
                : p.value === current;
                
              return (
                <button
                  key={p.value}
                  onClick={() => { onSelect(p.value); onClose(); }}
                  className={cn(
                    "px-2 py-1 rounded-lg text-xs border transition-all font-bold",
                    isActive
                      ? "border-text-main bg-text-main text-surface-base"
                      : "border-border-subtle text-text-main/60 hover:text-text-main hover:bg-white/5"
                  )}
                >{p.label}</button>
              );
            })}
          </div>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              placeholder={placeholder}
              defaultValue={current || ''}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = parseInt((e.target as HTMLInputElement).value);
                  if (val > 0) { onSelect(type === 'time' ? val * 60 : val); onClose(); }
                }
                if (e.key === 'Escape') onClose();
              }}
              className="flex-1 min-w-0 bg-surface-base border border-border-subtle rounded-xl px-2 py-1.5 text-sm text-text-main outline-none focus:border-text-main/40 w-16"
              autoFocus={true}
            />
            {current > 0 && (
              <button
                onClick={() => { onClear(); onClose(); }}
                className="text-xs text-text-main/40 hover:text-text-main/70 p-1 shrink-0"
              >{onClearLabel}</button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
