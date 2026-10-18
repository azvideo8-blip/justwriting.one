import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react';
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
// SA-23: на телефоне 40 px размытия на весь экран — самое дорогое в iOS Safari; blur-sm + плотнее фон.
const MODAL_BACKDROP = (z: keyof typeof BACKDROP_Z) =>
  `fixed inset-0 ${BACKDROP_Z[z]} flex items-center justify-center p-4 bg-surface-base/90 backdrop-blur-sm md:bg-surface-base/80 md:backdrop-blur-2xl`;
// MQ-11: слой листа задаётся пропом — окно сейфа (critical) поверх всего и листом на телефоне.
const SHEET_BACKDROP = (z: keyof typeof BACKDROP_Z) =>
  `fixed inset-0 ${BACKDROP_Z[z]} flex items-end justify-center touch-none`;
// N-4 (emil): сам слой затемнения — сосед листа, а не его родитель. У прозрачности
// родителя есть свойство, из-за которого MF-20 держался только в покое: 200 мс на
// входе и на уходе полупрозрачным оказывался и лист, и сквозь него была видна лента.
// color-ok: затемнение под листом одинаково тёмное в любой теме.
const SHEET_SCRIM = 'absolute inset-0 bg-black/60 backdrop-blur-sm';

// MF-20 (SA-6): уход вниз быстрее входа, по кривой читалки; затемнение плавно.
const SHEET_EASE = [0.32, 0.72, 0, 1] as const;
// Только у листов: десктопные модалки этот пакет не меняет.
const SHEET_BACKDROP_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

// MQ-5: лист открылся, пока прежний ещё в DOM (действия → переименование идёт уходом первого):
// его затемнение не стартует с нуля — иначе на кадр проступает страница.
const ANIMATION = {
  modal: {
    initial: { scale: 0.95, opacity: 0 },
    animate: { scale: 1, opacity: 1 },
    transition: { duration: 0.22, ease: 'easeOut' as const },
  },
  sheet: {
    // MQ-6: позиционный ключ `y`, а не строка `transform` — только его гасит MotionConfig reducedMotion.
    initial: { y: '100%' },
    animate: { y: '0%', transition: { type: 'spring' as const, duration: 0.32, bounce: 0 } },
    exit: { y: '100%', transition: { duration: 0.2, ease: SHEET_EASE } },
  },
};

// U-9 (решение владельца 2026-10-18): метка раздела — как на десктопе, моноширинный
// капс с разрядкой; на телефоне тот же вид, но кегль не мельче 12 px. SA-15 держал
// здесь строчные — отменено, см. DESIGN.md (The Quiet Label Rule).
export const SECTION_LABEL = 'font-mono text-[12px] uppercase tracking-widest text-text-main/60';

/** U-22 (решение владельца 2026-10-18): одна строка листа — 48 px, текст `/80`,
 *  черта между группами, как в `Menu`, а не рамка под каждой строкой. */
export const SHEET_ROW = 'w-full min-h-12 flex items-center gap-3 px-4 py-3 text-left text-[15px] font-medium text-text-main/80 transition-colors active:bg-text-main/[0.06]';

/** U-22: разделитель групп внутри листа — тот же, что `role="separator"` в `Menu`. */
export const SHEET_DIVIDER = 'my-1 h-px bg-border-subtle';

// 0.10.1 (просьба владельца): лист закрывается свайпом вниз. Порог — как у
// листов iOS: утянули ниже 80 px или смахнули быстро.
const SHEET_DISMISS_OFFSET = 80;
const SHEET_DISMISS_VELOCITY = 500;
/** Ревью 0.10.1: быстрый щелчок на 10–15 px закрывал лист с набранным названием. */
const SHEET_FLICK_MIN_OFFSET = 24;

export function shouldDismissSheet(offsetY: number, velocityY: number): boolean {
  return offsetY > SHEET_DISMISS_OFFSET || (offsetY > SHEET_FLICK_MIN_OFFSET && velocityY > SHEET_DISMISS_VELOCITY);
}

/**
 * Можно ли начать свайп листа с этой точки. Нельзя из поля ввода (там жест —
 * выделение текста) и из прокручиваемого блока, который не в самом верху: там
 * свайп вниз прокручивает содержимое — как в iOS, закрытие только «от верха».
 */
export function canStartSheetDrag(target: EventTarget | null, root: HTMLElement | null): boolean {
  if (!(target instanceof Element) || !root) return false;
  for (let el: Element | null = target; el && el !== root.parentElement; el = el.parentElement) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable === true) return false;
    if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) return false;
    if (el === root) break;
  }
  return true;
}

/** U-4 (решение владельца 2026-10-18): один заголовок листа на обоих
 *  устройствах, кегль — как у заголовка десктопной модалки (18 px).
 *  `className` нужен листам с обрезкой длинного названия. */
export function SheetTitle({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  return <h2 id={id} className={`text-[18px] font-semibold text-text-main${className ? ` ${className}` : ''}`}>{children}</h2>;
}

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
  const dragControls = useDragControls();
  // Листы сейфа (z="critical": пароль) свайпом не закрываются — только явно.
  const swipeable = variant === 'sheet' && !fullHeight && z !== 'critical';
  const { layoutMode } = useLayoutMode();
  useModalEscape(open && variant === 'modal', onClose);
  useFocusTrap(ref, open);
  const [handoff] = useState(() => open && variant === 'sheet' && !!document.querySelector('[role="dialog"]'));
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

  if (typeof document === 'undefined') return null;

  // MF-20: AnimatePresence внутри — лист уходит с анимацией, если вызывающий
  // держит ModalShell смонтированным и просто передаёт open.
  return createPortal(
    <AnimatePresence>
    {open && (
    <motion.div
      key="modal-shell"
      className={variant === 'sheet' ? SHEET_BACKDROP(z) : MODAL_BACKDROP(z)}
      onClick={onClose}
      onTouchMove={variant === 'sheet' ? e => e.preventDefault() : undefined}
    >
      {variant === 'sheet' ? (
        // MQ-5: при переходе лист-в-лист затемнение не стартует с нуля, если
        // другой лист ещё в DOM, — иначе на кадр проступает страница.
        <motion.div
          className={SHEET_SCRIM}
          onClick={onClose}
          {...(handoff ? { ...SHEET_BACKDROP_MOTION, initial: { opacity: 1 } } : SHEET_BACKDROP_MOTION)}
        />
      ) : (
        <div className="absolute inset-0" onClick={onClose} />
      )}
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onClick={e => e.stopPropagation()}
        {...ANIMATION[variant]}
        data-sheet-swipe={swipeable ? '' : undefined}
        {...(swipeable ? {
          drag: 'y' as const,
          dragControls,
          dragListener: false,
          dragConstraints: { top: 0, bottom: 0 },
          dragElastic: { top: 0, bottom: 0.6 },
          onPointerDown: (e: ReactPointerEvent) => { if (canStartSheetDrag(e.target, ref.current)) dragControls.start(e); },
          onDragEnd: (_e: unknown, info: PanInfo) => {
            if (shouldDismissSheet(info.offset.y, info.velocity.y)) onClose();
          },
        } : {})}
        className={
          variant === 'sheet'
            // MF-20 (SA-7): лист — поднятый слой, фон непрозрачный (`--surface-popup`
            // во всех четырёх темах); `--surface-card` полупрозрачен для ленты.
            // color-ok: тень листа — чёрная в любой теме.
            ? `relative z-10 w-full max-w-lg bg-surface-popup border-t border-border-subtle overflow-hidden flex flex-col shadow-[0_-8px_32px_rgba(0,0,0,0.4)] pb-safe ${fullHeight ? 'h-[100dvh] max-h-[100dvh] rounded-none' : 'rounded-t-[28px] max-h-[85vh]'} ${className ?? ''}`
            : `relative z-10 w-full max-w-lg ${className ?? ''}`
        }
      >
        {children}
      </motion.div>
    </motion.div>
    )}
    </AnimatePresence>,
    document.body,
  );
}
