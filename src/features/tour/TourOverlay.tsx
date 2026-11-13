import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { useLanguage } from '../../shared/i18n';
import { useLayoutMode } from '../../shared/hooks/useLayoutMode';
import { useModalEscape } from '../../shared/hooks/useModalEscape';
import { useAiConsentOff } from '../../core/ai/useAiConsentOff';
import { cn } from '../../core/utils/utils';
import { tourBodyKey, tourSteps } from './steps';
import { writeTourState, type TourState } from './tourState';

interface Box { top: number; left: number; right: number; bottom: number }
interface Geo { main: Box | null; second: Box | null; hasMic: boolean; vw: number; vh: number }

const TICK_MS = 200;
/** Столько ждём цель после перехода; дальше карточка по центру без кольца. */
const TARGET_WAIT_MS = 3000;
/** Чужое окно или степпер первого входа: тур уступает им экран. */
export const FOREIGN_DIALOG = '[role="dialog"]:not([data-tour-card]), [data-testid="first-run-stepper"]';

function boxOf(selector: string | undefined): Box | null {
  if (!selector) return null;
  // Метка бывает на двух элементах сразу (микрофон в верхней и нижней панели) —
  // берём тот, что на экране.
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
  }
  return null;
}

function sameBox(a: Box | null, b: Box | null) {
  return a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.right === b.right && a.bottom === b.bottom);
}

function isTextField(el: Element | null): el is HTMLElement {
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || (el as HTMLElement).isContentEditable);
}

/** Кольцо вокруг цели, не вылезающее за окно (поле текста бывает во весь экран). */
function ringStyle(b: Box, g: Geo, pad: number): CSSProperties {
  const top = Math.max(2, b.top - pad);
  const left = Math.max(2, b.left - pad);
  return {
    top, left,
    width: Math.min(g.vw - 2, b.right + pad) - left,
    height: Math.min(g.vh - 2, b.bottom + pad) - top,
  };
}

/** Где стоит карточка: под целью, над ней, а если не влезает — у нижнего края
 *  окна (или у верха цели, когда вторая цель внизу). Высоту карточки не меряем — берём запас. */
function cardStyle(g: Geo, mobile: boolean): CSSProperties {
  const side: CSSProperties = mobile ? { left: 12, right: 12 } : { width: 340 };
  if (!g.main) return side;
  const need = mobile ? 280 : 240;
  const left = mobile ? undefined : Math.max(12, Math.min(g.main.left, g.vw - 340 - 12));
  if (g.vh - g.main.bottom - 12 >= need) return { ...side, left: left ?? 12, top: g.main.bottom + 14 };
  if (g.main.top - 12 >= need) return { ...side, left: left ?? 12, bottom: g.vh - g.main.top + 14 };
  const insideLeft = mobile ? 12 : Math.max(12, g.main.right - 340 - 20);
  const secondBelow = !!g.second && g.second.top > (g.main.top + g.main.bottom) / 2;
  return secondBelow || (mobile && !g.second)
    ? { ...side, left: insideLeft, top: Math.max(12, g.main.top + 56) }
    : { ...side, left: insideLeft, bottom: 12 };
}

interface TourOverlayProps {
  /** Чья отметка; `null` (гость) — отметка не пишется. */
  uid: string | null;
  isGuest: boolean;
  onClose: () => void;
}

/**
 * TR-2: знакомство — модальное окно-карточка и кольцо вокруг цели. Ничего не
 * нажимает за человека, не открывает листы и не ставит фокус в поле текста:
 * на телефоне это подняло бы клавиатуру и спрятало вкладки.
 */
export function TourOverlay({ uid, isGuest, onClose }: TourOverlayProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const mobile = useLayoutMode().layoutMode === 'mobile';
  const reducedMotion = useReducedMotion();
  const aiOff = useAiConsentOff();
  const steps = useMemo(() => tourSteps(isGuest), [isGuest]);
  const [idx, setIdx] = useState(0);
  const step = steps[idx]!;
  const last = idx === steps.length - 1;
  // null — цель ещё ищем (страница ленивая): на экране только затемнение.
  const [geo, setGeo] = useState<Geo | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const arrived = useRef(false);
  const closed = useRef(false);
  const [prevFocus] = useState(() => document.activeElement as HTMLElement | null);

  const finish = (mark: TourState | null) => {
    if (closed.current) return;
    closed.current = true;
    if (mark && uid) writeTourState(uid, mark);
    // Фокус — туда, где был; на телефоне не в поле текста (клавиатура).
    if (prevFocus && document.contains(prevFocus) && !(mobile && isTextField(prevFocus))) prevFocus.focus?.();
    onClose();
  };
  const finishRef = useRef(finish);
  useEffect(() => { finishRef.current = finish; });

  useEffect(() => {
    if (isTextField(document.activeElement)) document.activeElement.blur();
  }, []);

  // Переход на экран шага. Ушли с него не мы (жест «назад», ссылка) — тур
  // закрывается без отметки и вернётся в следующий заход.
  useEffect(() => {
    if (pathname === step.route) arrived.current = true;
    else if (arrived.current) finishRef.current(null);
    else void navigate(step.route);
  }, [pathname, step.route, navigate]);

  // ponytail: один таймер вместо ResizeObserver + слушателей — ловит и поворот,
  // и перерисовку цели, и чужое окно; отставание до 200 мс. Тур живёт секунды.
  useEffect(() => {
    if (pathname !== step.route) return;
    let waited = 0;
    const measure = () => {
      if (document.querySelector(FOREIGN_DIALOG)) { finishRef.current(null); return; }
      const main = boxOf(step.target(mobile));
      waited += TICK_MS;
      if (!main && waited < TARGET_WAIT_MS) return;
      const second = main ? boxOf(step.second) : null;
      // На телефоне поле текста уходит под панель записи и вкладки: кольцо
      // кончается над второй целью, а не обводит весь экран.
      if (main && second && second.top > (main.top + main.bottom) / 2 && second.top < main.bottom) {
        main.bottom = second.top - 12;
      }
      const next: Geo = {
        main,
        second,
        hasMic: !!boxOf('[data-tour="mic"]'),
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
      setGeo(prev => (prev && sameBox(prev.main, next.main) && sameBox(prev.second, next.second)
        && prev.hasMic === next.hasMic && prev.vw === next.vw && prev.vh === next.vh ? prev : next));
    };
    const id = window.setInterval(measure, TICK_MS);
    window.addEventListener('resize', measure);
    return () => { window.clearInterval(id); window.removeEventListener('resize', measure); };
  }, [pathname, step, mobile]);

  // Фокус на карточку при каждом шаге — диктор читает заголовок и текст.
  const shown = geo !== null;
  useEffect(() => { if (shown) cardRef.current?.focus(); }, [shown, idx]);

  // Esc считается, только когда карточка на экране: иначе «пропущено» ставилось бы
  // за тур, которого человек не видел (ревью 0.11.14).
  useModalEscape(shown, () => finish(`skipped:${idx + 1}`));

  const go = (next: number) => { arrived.current = false; setGeo(null); setIdx(next); };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button'));
    const first = buttons[0];
    const lastBtn = buttons[buttons.length - 1];
    if (!first || !lastBtn) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === e.currentTarget)) { e.preventDefault(); lastBtn.focus(); }
    else if (!e.shiftKey && active === lastBtn) { e.preventDefault(); first.focus(); }
  };

  const ghost = 'min-h-11 min-w-11 px-3 rounded-xl text-sm text-text-main/70 hover:text-text-main hover:bg-text-main/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft';
  const ringMotion = !reducedMotion && 'transition-[top,left,width,height] duration-200';

  return createPortal(
    <>
      {/* not-a-modal: tour overlay — глушит нажатия по приложению; окно — карточка ниже */}
      <div
        data-testid="tour-backdrop"
        className={cn('fixed inset-0 z-[var(--z-modal)]', !geo?.main && 'bg-black/60')}
      />
      {geo?.main && (
        <div
          data-testid="tour-ring"
          aria-hidden="true"
          className={cn('pointer-events-none fixed z-[var(--z-modal)] rounded-2xl border-2 border-brand-soft', ringMotion)}
          style={{ ...ringStyle(geo.main, geo, 6), boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.6)' }}
        />
      )}
      {geo?.second && (
        <div
          data-testid="tour-ring-second"
          aria-hidden="true"
          className={cn('pointer-events-none fixed z-[var(--z-modal)] rounded-xl border-2 border-brand-soft', ringMotion)}
          style={ringStyle(geo.second, geo, 4)}
        />
      )}
      {geo && (
        <div
          ref={cardRef}
          data-tour-card=""
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={cn(
            'fixed z-[var(--z-modal)] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl border border-border-subtle bg-surface-popup p-4 shadow-2xl outline-none',
            // Цели нет — карточка по центру, текст полезен и без подсветки.
            !geo.main && 'left-1/2 top-1/2 w-[min(340px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2',
          )}
          style={geo.main ? cardStyle(geo, mobile) : undefined}
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="tour-title" className="text-[15px] font-semibold text-text-main">{t(step.titleKey)}</h2>
            <span className="shrink-0 pt-0.5 text-xs text-text-main/60">{t('tour_step_of', { current: idx + 1, total: steps.length })}</span>
          </div>
          <p id="tour-body" className="mt-1.5 text-sm text-text-main/80">
            {t(tourBodyKey(step.id, { hasMic: geo.hasMic, aiOff }))}
          </p>
          <div className="mt-3 flex items-center gap-1">
            {!last && (
              <button type="button" className={ghost} onClick={() => finish(`skipped:${idx + 1}`)}>{t('tour_skip')}</button>
            )}
            <span className="flex-1" />
            {idx > 0 && (
              <button type="button" className={ghost} onClick={() => go(idx - 1)}>{t('common_back')}</button>
            )}
            <button
              type="button"
              className="min-h-11 min-w-11 px-4 rounded-xl bg-text-main text-sm font-semibold text-surface-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft"
              onClick={() => (last ? finish('done') : go(idx + 1))}
            >
              {t(last ? 'common_done' : 'tour_next')}
            </button>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
