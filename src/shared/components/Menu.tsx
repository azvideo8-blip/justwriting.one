import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { cn } from '../../shared/utils/cn';
import { Button } from './Button';

export type MenuEntry =
  | {
      kind: 'item';
      key: string;
      label: string;
      icon?: ReactNode;
      hint?: string;
      destructive?: boolean;
      onSelect: () => void;
    }
  | {
      kind: 'radio';
      key: string;
      label: string;
      icon?: ReactNode;
      checked: boolean;
      onSelect: () => void;
    }
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'separator'; key: string };

export type MenuRect = { top: number; bottom: number; left: number; right: number };

export type MenuAnchor =
  | { kind: 'trigger'; rect: MenuRect; trigger: HTMLElement | null }
  | { kind: 'point'; x: number; y: number };

const EDGE = 8;
const GAP = 4;

type Position = { left: number; top: number; maxHeight: number };

function selectable(entries: MenuEntry[]): number[] {
  return entries.reduce<number[]>((acc, entry, i) => {
    if (entry.kind === 'item' || entry.kind === 'radio') acc.push(i);
    return acc;
  }, []);
}

// DC-A2: единое меню для «⋯» в строке заметки и для контекстного вызова.
// Позиционируется по триггеру или по точке курсора, разворачивается вверх,
// если вниз не помещается, и живёт в портале, чтобы не обрезаться в сетке.
export function Menu({
  entries,
  anchor,
  onClose,
  label,
  align = 'end',
  minWidth = 200,
}: {
  entries: MenuEntry[];
  anchor: MenuAnchor;
  onClose: () => void;
  label?: string;
  align?: 'start' | 'end';
  minWidth?: number;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const [pos, setPos] = useState<Position | null>(null);
  const focusFirst = useRef(true);
  const menuId = useId();
  // У контекстного меню триггера нет: запоминаем, где был фокус до открытия.
  // Состояние, а не ref: значение читают обработчики, собранные при рендере.
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null,
  );

  const stops = selectable(entries);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    let top: number;
    let left: number;
    if (anchor.kind === 'point') {
      top = anchor.y;
      left = anchor.x;
    } else {
      top = anchor.rect.bottom + GAP;
      left = align === 'end' ? anchor.rect.right - width : anchor.rect.left;
    }

    const spaceBelow = vh - top - EDGE;
    if (height > spaceBelow) {
      const above = anchor.kind === 'point' ? anchor.y - height : anchor.rect.top - height - GAP;
      if (above >= EDGE) top = above;
      else {
        top = EDGE;
      }
    }
    left = Math.max(EDGE, Math.min(left, vw - width - EDGE));
    setPos({ left, top, maxHeight: Math.max(120, vh - top - EDGE) });
  }, [anchor, align, minWidth, entries.length]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (anchor.kind === 'trigger' && anchor.trigger?.contains(target)) return;
      onClose();
    };
    const onScroll = (e: Event) => {
      // Длинное меню прокручивается само (overflow-y-auto); слушатель стоит на
      // window с capture и ловит и эту прокрутку — закрываться по ней нельзя.
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [anchor, onClose]);

  const focusItem = (index: number | undefined) => {
    if (index === undefined) return;
    itemRefs.current.get(index)?.focus();
  };

  useEffect(() => {
    if (!pos || !focusFirst.current || stops.length === 0) return;
    focusFirst.current = false;
    focusItem(stops[0]);
  }, [pos, stops]);

  const moveFocus = (from: number, dir: 1 | -1) => {
    const at = stops.indexOf(from);
    if (at === -1) return;
    focusItem(stops[(at + dir + stops.length) % stops.length]);
  };

  // Фокус возвращается открывшему: триггеру, а у контекстного меню — элементу,
  // на котором он был. Иначе после закрытия он падает в body.
  const restoreFocus = () => {
    const target = anchor.kind === 'trigger' ? anchor.trigger : opener;
    if (target?.isConnected === true) target.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    // Tab закрывает меню, как и Esc: иначе фокус уходит на страницу за открытым
    // меню (оно живёт в портале в конце body), а само меню остаётся висеть.
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      restoreFocus();
      return;
    }
    const current = Number(e.currentTarget.getAttribute('data-index'));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(current, 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(current, -1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(stops[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(stops[stops.length - 1]);
    }
  };

  const renderItem = (entry: MenuEntry, i: number) => {
    if (entry.kind === 'heading') return null; // заголовок рисует группа ниже
    if (entry.kind === 'separator') {
      return <div key={entry.key} role="separator" className="my-1 h-px bg-border-subtle" />;
    }

    const isRadio = entry.kind === 'radio';
    return (
      <Button
        key={entry.key}
        ref={(node) => {
          if (node) itemRefs.current.set(i, node);
          else itemRefs.current.delete(i);
        }}
        type="button"
        role={isRadio ? 'menuitemradio' : 'menuitem'}
        aria-checked={isRadio ? entry.checked : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-index={i}
        onClick={() => {
          // Сначала фокус, потом действие: действие вправе забрать его себе
          // (поле переименования, поле тега, диалог).
          restoreFocus();
          entry.onSelect();
          onClose();
        }}
        className={cn(
          'w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-sm text-left whitespace-nowrap',
          isRadio && entry.checked ? 'bg-text-main/10 text-text-main' : 'text-text-main/80 hover:bg-text-main/5',
          !isRadio && entry.destructive && 'text-accent-danger hover:bg-accent-danger/10',
        )}
      >
        {entry.icon !== undefined && <span className="shrink-0 flex items-center" aria-hidden="true">{entry.icon}</span>}
        <span className="flex-1 truncate">{entry.label}</span>
        {!isRadio && entry.hint !== undefined && <span className="text-xs text-text-main/40">{entry.hint}</span>}
        {isRadio && entry.checked && <Check size={14} aria-hidden="true" className="shrink-0" />}
      </Button>
    );
  };

  // Заголовок и идущие за ним радиопункты — одна группа с именем из заголовка:
  // без неё скринридер объявляет «радиокнопка 1 из 2», не говоря, чего именно.
  type Indexed = { entry: MenuEntry; index: number };
  const units: Array<Indexed & { radios: Indexed[] }> = [];
  entries.forEach((entry, index) => {
    // Последняя единица — заголовок, значит после него шли только радиопункты:
    // любой другой пункт открыл бы свою единицу.
    const group = units[units.length - 1];
    if (entry.kind === 'radio' && group?.entry.kind === 'heading') group.radios.push({ entry, index });
    else units.push({ entry, index, radios: [] });
  });

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        maxHeight: pos?.maxHeight,
        minWidth,
        visibility: pos ? 'visible' : 'hidden',
      }}
      // flex-col обязателен: пункты — inline-flex с w-full, и в обычном блоке
      // ширина «по содержимому» считалась как все пункты в одну строку — меню
      // из восьми пунктов выходило шириной 840px (найдено проходом в браузере).
      className="z-[var(--z-overlay)] flex flex-col overflow-y-auto rounded-xl border border-border-subtle bg-surface-popup p-1.5 shadow-card"
    >
      {units.map(({ entry, index, radios }) => {
        if (entry.kind !== 'heading') return renderItem(entry, index);
        const headingId = `${menuId}-${entry.key}`;
        return (
          <div key={entry.key} role="group" aria-labelledby={headingId} className="flex flex-col">
            {/* /70, не /40: это текст, и на 40% он давал 2.5–3.7:1 во всех четырёх
                темах при пороге 4.5:1 (замер в браузере). На 60% светлая тема
                «Тёплый» всё ещё не дотягивает — 4.3:1. */}
            <div id={headingId} className="px-3 pt-2 pb-1 text-xs text-text-main/70">
              {entry.label}
            </div>
            {radios.map(r => renderItem(r.entry, r.index))}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
