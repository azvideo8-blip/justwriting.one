import { type RefObject, useState, useEffect, useRef } from 'react';
import { Search, LayoutGrid, LayoutList, ArrowUpDown, SlidersHorizontal, Tag, Upload, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { Input } from '../../../shared/components/Input';
import { useLanguage } from '../../../shared/i18n';

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
  onFilterClick?: () => void;
  showFilters?: boolean;
  onToggleFilters?: () => void;
  toggleFiltersLabel?: string;
  onImportClick?: () => void;
  importLabel?: string;
  activeTab?: 'notes' | 'trash';
  onTabChange?: (tab: 'notes' | 'trash') => void;
  notesTabLabel?: string;
  trashTabLabel?: string;
  trashCount?: number;
}

export function ArchiveHeader({
  title, count, countLabel, subtitle,
  searchQuery, searchInputRef, onSearchChange, searchPlaceholder,
  viewMode, onViewModeChange, listLabel, gridLabel,
  sortMode, onSortModeChange, sortLabels,
  onFilterClick,
  showFilters,
  onToggleFilters,
  toggleFiltersLabel = 'Теги',
  onImportClick,
  importLabel = 'Импорт',
  activeTab = 'notes',
  onTabChange,
  notesTabLabel,
  trashTabLabel,
  trashCount,
}: ArchiveHeaderProps) {
  const { t } = useLanguage();
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
    <div className="py-6 pb-[18px] border-b border-[var(--color-border-subtle)]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-3xl font-medium tracking-tight text-text-main">
            {title}
          </h1>
          <span className="font-mono text-label-sm text-text-main/60 uppercase tracking-widest">
            {count} {countLabel}
          </span>
        </div>
        {onTabChange && (
          <div className="flex bg-text-main/[0.04] border border-border-subtle rounded-lg p-0.5">
            <Button
              onClick={() => onTabChange('notes')}
              className={cn(
                "relative px-3 py-1 rounded-md text-sm font-medium transition-colors z-10",
                activeTab === 'notes' ? "text-text-main" : "text-text-main/60 hover:text-text-main"
              )}
            >
              {activeTab === 'notes' && (
                <motion.div
                  layoutId="archive-tab-pill"
                  className="absolute inset-0 bg-text-main/20 rounded-md"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative z-10">{notesTabLabel || t('archive_tab_notes')}</span>
            </Button>
            <Button
              onClick={() => onTabChange('trash')}
              className={cn(
                "relative px-3 py-1 rounded-md text-sm font-medium transition-colors z-10 flex items-center gap-1.5",
                activeTab === 'trash' ? "text-text-main" : "text-text-main/60 hover:text-text-main"
              )}
            >
              {activeTab === 'trash' && (
                <motion.div
                  layoutId="archive-tab-pill"
                  className="absolute inset-0 bg-text-main/20 rounded-md"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <Trash2 size={13} aria-hidden="true" />
                <span>{trashTabLabel || t('archive_tab_trash')}</span>
                {trashCount !== undefined && trashCount > 0 && (
                  <span className="font-mono text-xs opacity-75">({trashCount})</span>
                )}
              </span>
            </Button>
          </div>
        )}
      </div>
      <p className="text-sm text-text-main/60 mb-5">
        {subtitle}
      </p>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-[440px]">
          <Search size={14} className="absolute left-3 top-2.5 text-text-main/60" aria-hidden="true" />
          <Input
            ref={searchInputRef}
            aria-label={searchPlaceholder}
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8 pr-12 py-2 bg-text-main/[0.03] border border-border-subtle rounded-lg text-sm text-text-main placeholder:text-text-main/40 outline-none focus:border-border-subtle/60 transition-colors"
          />
          <AnimatePresence>
            {!searchQuery && (
              <motion.kbd
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-label text-text-main/60 border border-border-subtle rounded px-1.5 py-0.5 leading-none"
              >
                ⌘K
              </motion.kbd>
            )}
          </AnimatePresence>
        </div>
        <div className="flex bg-text-main/[0.03] border border-border-subtle rounded-lg p-0.5">
          {(['list', 'grid'] as const).map(v => (
            <Button
              key={v}
              onClick={() => onViewModeChange(v)}
              className="relative w-8 h-7 p-0 rounded-md flex items-center justify-center transition-colors z-10"
              title={v === 'list' ? listLabel : gridLabel}
              aria-label={v === 'list' ? listLabel : gridLabel}
            >
              {viewMode === v && (
                <motion.div
                  layoutId="view-mode-pill"
                  className="absolute inset-0 bg-text-main/25 rounded-md"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className={cn("relative z-10", viewMode === v ? "text-text-main" : "text-text-main/60")}>
                {v === 'list' ? <LayoutList size={14} aria-hidden="true" /> : <LayoutGrid size={14} aria-hidden="true" />}
              </span>
            </Button>
          ))}
        </div>
        <div ref={sortRef} className="relative">
          <Button
            onClick={() => setSortOpen(o => !o)}
            aria-expanded={sortOpen}
            className={cn(
              "h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-sm transition-colors border",
              sortOpen
                ? "bg-text-main/10 border-border-subtle/60 text-text-main"
                : sortMode !== 'newest'
                  ? "bg-brand-soft/20 border-brand-soft/40 text-brand-soft"
                  : "bg-text-main/[0.03] border-border-subtle text-text-main/60 hover:text-text-main"
            )}
            title={sortLabels[sortMode]}
          >
            <ArrowUpDown size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{sortLabels[sortMode]}</span>
          </Button>
          {sortOpen && (
            <div className="absolute right-0 top-full mt-1 py-1 w-48 bg-surface-elevated border border-border-subtle rounded-lg shadow-xl z-30">
              {SORT_OPTIONS.map(mode => (
                <Button
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
                </Button>
              ))}
            </div>
          )}
        </div>
        {onToggleFilters && (
          <Button
            onClick={onToggleFilters}
            aria-expanded={showFilters}
            className={cn(
              "h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-sm transition-colors border",
              showFilters
                ? "bg-brand-soft/20 border-brand-soft/40 text-brand-soft"
                : "bg-text-main/[0.03] border-border-subtle text-text-main/60 hover:text-text-main"
            )}
          >
            <Tag size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{toggleFiltersLabel}</span>
          </Button>
        )}
        {onImportClick && (
          <Button
            onClick={onImportClick}
            className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-sm transition-colors border bg-text-main/[0.03] border-border-subtle text-text-main/60 hover:text-text-main"
          >
            <Upload size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{importLabel}</span>
          </Button>
        )}
        {onFilterClick && (
          <IconButton
            onClick={onFilterClick}
            className="md:hidden h-8 px-2.5 rounded-lg flex items-center justify-center border border-border-subtle bg-text-main/[0.03] text-text-main/60 hover:text-text-main active:scale-[0.98] transition-colors cursor-pointer"
            label={t('archive_filters')}
            icon={<SlidersHorizontal size={14} aria-hidden="true" />}
          />
        )}
      </div>
    </div>
  );
}
