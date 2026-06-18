import { useRef, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useModalEscape } from '../hooks/useModalEscape';

interface ModalWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  titleId: string;
  labelledBy?: string;
  describedBy?: string;
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  backdropClassName?: string;
  onBackdropClick?: () => void;
  maxWidth?: string;
}

export function ModalWrapper({
  isOpen,
  onClose,
  titleId,
  labelledBy,
  describedBy,
  ariaLabel,
  children,
  className,
  contentClassName,
  backdropClassName,
  onBackdropClick,
  maxWidth = 'max-w-sm',
}: ModalWrapperProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useFocusTrap(modalRef, isOpen);
  useModalEscape(isOpen, onClose);

  if (!isOpen) return null;

  const handleBackdropClick = () => {
    if (onBackdropClick) onBackdropClick();
    else onClose();
  };

  return (
    <div
      className={`fixed inset-0 z-[var(--z-critical)] flex items-center justify-center p-4 bg-surface-base/80 backdrop-blur-md ${backdropClassName ?? ''}`}
      onClick={handleBackdropClick}
    >
      <motion.div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? titleId}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        id={titleId}
        initial={reducedMotion ? {} : { scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={reducedMotion ? {} : { scale: 0.95, opacity: 0 }}
        className={`w-full ${maxWidth} bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg ${contentClassName ?? ''} ${className ?? ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </div>
  );
}
