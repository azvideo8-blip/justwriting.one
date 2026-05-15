import { type RefObject, useState, useEffect, useRef } from 'react';
import { Search, LayoutGrid, LayoutList, ArrowUpDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../../core/utils/utils';

export type SortMode = 'newest' | 'oldest' | 'longest' | 'shortest' | 'title_az' | 'title_za';

const SORT_OPTIONS: SortMode[] = ['newest', 'oldest', 'longest', 'shortest', 'title_az', 'title_za'];

interface ArchiveHeaderProps {
  title: string;
  count: number;
  countLabel: string;
  subtitle: string;
  searchQuery: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSearchChange: (q: string) => void;
  searchPlaceholder: string;
  viewMode: 'list' | 'grid';
  onViewModeChange: (v: 'list' | 'grid') => void;
  listLabel: string;
  gridLabel: string;
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
  sortLabels: Record<SortMode, string>;
}

export function ArchiveHeader({
  title, count, countLabel, subtitle,
  searchQuery, searchInputRef, onSearchChange, searchPlaceholder,
  viewMode, onViewModeChange, listLabel, gridLabel,
  sortMode, onSortModeChange, sortLabels,
}: ArchiveHeaderProps) {
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sortOpen]);

  return (
    <div style={{ padding: '24px 0 18px', borderBottom: '1px solid var(--color-border-subtle)' }}>
      <div className="flex items-baseline gap-3 mb-1">
        <h1 className="text-3xl font-medium tracking-tight text-text-main">
          {title}
        </h1>
        <span className="font-mono text-[11px] text-text-main/30 uppercase tracking-widest">
          {count} {countLabel}
        </span>
      </div>
      <p className="text-sm text-text-main/40 mb-5">
        {subtitle}
      </p>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-[440px]">
          <Search size={14} className="absolute left-3 top-2.5 text-text-main/30" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-8 pr-12 py-2 bg-text-main/[0.03] border border-border-subtle rounded-lg text-sm text-text-main placeholder:text-text-main/25 outline-none focus:border-border-subtle/60 transition-colors"
          />
          <AnimatePresence>
            {!searchQuery && (
              <motion.kbd
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-text-main/20 border border-border-subtle rounded px-1.5 py-0.5 leading-none"
              >
                ⌘K
              </motion.kbd>
            )}
          </AnimatePresence>
        </div>
        <div className="flex bg-text-main/[0.03] border border-border-subtle rounded-lg p-0.5">
          {(['list', 'grid'] as const).map(v => (
            <button
              key={v}
              onClick={() => onViewModeChange(v)}
              className="relative w-8 h-7 rounded-md flex items-center justify-center transition-colors z-10"
              title={v === 'list' ? listLabel : gridLabel}
              aria-label={v === 'list' ? listLabel : gridLabel}
            >
              {viewMode === v && (
                <motion.div
                  layoutId="view-mode-pill"
                  className="absolute inset-0 bg-text-main/15 rounded-md"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className={cn("relative z-10", viewMode === v ? "text-text-main" : "text-text-main/30")}>
                {v === 'list' ? <LayoutList size={14} /> : <LayoutGrid size={14} />}
              </span>
            </button>
          ))}
        </div>
        <div ref={sortRef} className="relative">
          <button
            onClick={() => setSortOpen(o => !o)}
            className={cn(
              "h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-sm transition-all border",
              sortOpen
                ? "bg-text-main/10 border-border-subtle/60 text-text-main"
                : sortMode !== 'newest'
                  ? "bg-brand-soft/20 border-brand-soft/40 text-brand-soft"
                  : "bg-text-main/[0.03] border-border-subtle text-text-main/40 hover:text-text-main/60"
            )}
            title={sortLabels[sortMode]}
          >
            <ArrowUpDown size={14} />
            <span className="hidden sm:inline">{sortLabels[sortMode]}</span>
          </button>
          {sortOpen && (
            <div className="absolute right-0 top-full mt-1 py-1 w-48 bg-bg-main border border-border-subtle rounded-lg shadow-lg z-30">
              {SORT_OPTIONS.map(mode => (
                <button
                  key={mode}
                  onClick={() => { onSortModeChange(mode); setSortOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-sm transition-colors",
                    sortMode === mode
                      ? "text-brand-soft bg-brand-soft/10 font-medium"
                      : "text-text-main/60 hover:text-text-main hover:bg-text-main/[0.04]"
                  )}
                >
                  {sortLabels[mode]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
