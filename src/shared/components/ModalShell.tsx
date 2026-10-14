import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useModalEscape } from '../hooks/useModalEscape';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { usePanelHistory } from '../hooks/usePanelHistory';

// AUDIT-part2 3.1: единый примитив модалки. Хуки решают поведение
// (Escape, фокус-трап), но не гарантируют разметку — role/aria-modal/
// stopPropagation живут здесь, поэтому новая модалка физически не может
// повторить ситуацию M21 («10 модалок без трапа»).
//
// MB-4 (F-4, F-23): окно рендерится порталом в document.body. Внутри `main`
// этого нельзя: у main `relative z-10` — свой контекст наложения, а BottomNav
// лежит снаружи со слоем --z-sidebar, и любое окно внутри main оказывается под
// панелью («Сохранить» в окне завершения) — а `fixed` внутри предка с
// transform/backdrop-filter считается от него, из-за чего листы архива уезжали
// за левый край (x=−36) и страница за ними оставалась кликабельной.
// Проще снять z-10 с main нельзя: им прижат ThemeBackground.

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
  /** MC-3: лист на весь экран (чтение и «Записано.»), а не на 85 % высоты. */
  fullHeight?: boolean;
  className?: string;
}

export function ModalShell({
  open,
  onClose,
  labelId,
  children,
  variant = 'modal',
  z = variant === 'sheet' ? 'sheet' : 'modal',
  fullHeight = false,
  className,
}: ModalShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { layoutMode } = useLayoutMode();
  useModalEscape(open && variant === 'modal', onClose);
  useFocusTrap(ref, open);
  // MB-9: на телефоне «назад» закрывает лист/модалку, а не уводит из приложения.
  usePanelHistory(open, onClose, layoutMode !== 'desktop');

  // Блокировка прокрутки фона на время модалки.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
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
            ? `relative z-10 w-full max-w-lg bg-surface-card border-t border-white/[0.06] overflow-hidden flex flex-col shadow-[0_-8px_32px_rgba(0,0,0,0.4)] pb-safe ${fullHeight ? 'h-[100dvh] max-h-[100dvh] rounded-none' : 'rounded-t-[28px] max-h-[85vh]'} ${className ?? ''}`
            : `relative z-10 w-full max-w-lg ${className ?? ''}`
        }
      >
        {children}
      </motion.div>
    </div>,
    document.body,
  );
}
