import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useModalEscape } from '../hooks/useModalEscape';

// AUDIT-part2 3.1: единый примитив модалки. Хуки решают поведение
// (Escape, фокус-трап), но не гарантируют разметку — role/aria-modal/
// stopPropagation живут здесь, поэтому новая модалка физически не может
// повторить ситуацию M21 («10 модалок без трапа»).

const BACKDROP_Z: Record<'modal' | 'critical' | 'sheet', string> = {
  modal: 'z-[var(--z-modal)]',
  critical: 'z-[var(--z-critical)]',
  sheet: 'z-[var(--z-sheet)]',
};

// AUDIT-part3 1: критичные модалки (поверх всего — unlock, consent) задают
// слой пропом, а не копией классов бэкдропа.
const MODAL_BACKDROP = (z: keyof typeof BACKDROP_Z) =>
  `fixed inset-0 ${BACKDROP_Z[z]} flex items-center justify-center p-4 bg-surface-base/80 backdrop-blur-2xl`;
const SHEET_BACKDROP =
  `fixed inset-0 ${BACKDROP_Z.sheet} flex items-end justify-center bg-black/60 backdrop-blur-sm touch-none`;

const ANIMATION = {
  modal: {
    initial: { scale: 0.95, opacity: 0 },
    animate: { scale: 1, opacity: 1 },
    transition: { duration: 0.22, ease: 'easeOut' as const },
  },
  sheet: {
    initial: { y: '100%' },
    animate: { y: 0 },
    transition: { type: 'spring' as const, damping: 28, stiffness: 280 },
  },
};

export interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  /** id заголовка для aria-labelledby; заголовок обязан быть в children. */
  labelId: string;
  children: ReactNode;
  /** sheet = мобильный bottom-sheet (выезд снизу). */
  variant?: 'modal' | 'sheet';
  /** Слой бэкдропа: critical — поверх всего (unlock, consent). */
  z?: 'modal' | 'critical' | 'sheet';
  className?: string;
}

export function ModalShell({
  open,
  onClose,
  labelId,
  children,
  variant = 'modal',
  z = variant === 'sheet' ? 'sheet' : 'modal',
  className,
}: ModalShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalEscape(open && variant === 'modal', onClose);
  useFocusTrap(ref, open);

  // Блокировка прокрутки фона на время модалки.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={variant === 'sheet' ? SHEET_BACKDROP : MODAL_BACKDROP(z)}
      onClick={onClose}
      onTouchMove={variant === 'sheet' ? e => e.preventDefault() : undefined}
    >
      <div className="absolute inset-0" onClick={onClose} />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onClick={e => e.stopPropagation()}
        {...ANIMATION[variant]}
        className={
          variant === 'sheet'
            ? `relative z-10 w-full max-w-lg bg-surface-card border-t border-white/[0.06] rounded-t-[28px] overflow-hidden flex flex-col max-h-[85vh] shadow-[0_-8px_32px_rgba(0,0,0,0.4)] pb-safe ${className ?? ''}`
            : `relative z-10 w-full max-w-lg ${className ?? ''}`
        }
      >
        {children}
      </motion.div>
    </div>
  );
}
