import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
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
      disabled?: boolean;
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
    if (entry.kind !== 'item' && entry.kind !== 'radio') return acc;
    if (entry.kind === 'item' && entry.disabled) return acc;
    acc.push(i);
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
    const onScroll = () => onClose();
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

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const trigger = anchor.kind === 'trigger' ? anchor.trigger : null;
      onClose();
      trigger?.focus();
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
    if (entry.kind === 'separator') {
      return <div key={entry.key} role="separator" className="my-1 h-px bg-border-subtle" />;
    }
    if (entry.kind === 'heading') {
      return (
        <div key={entry.key} className="px-3 pt-2 pb-1 text-xs text-text-main/40">
          {entry.label}
        </div>
      );
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
        disabled={!isRadio && entry.disabled}
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-index={i}
        onClick={() => {
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
      className="z-[var(--z-overlay)] overflow-y-auto rounded-xl border border-border-subtle bg-surface-popup p-1.5 shadow-card"
    >
      {entries.map(renderItem)}
    </div>,
    document.body,
  );
}
