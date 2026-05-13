import { type RefObject } from 'react';
import { Search, LayoutGrid, LayoutList } from 'lucide-react';
import { cn } from '../../../core/utils/utils';

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
}

export function ArchiveHeader({
  title, count, countLabel, subtitle,
  searchQuery, searchInputRef, onSearchChange, searchPlaceholder,
  viewMode, onViewModeChange, listLabel, gridLabel,
}: ArchiveHeaderProps) {
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
            className="w-full pl-8 pr-10 py-2 bg-text-main/[0.03] border border-border-subtle rounded-lg text-sm text-text-main placeholder:text-text-main/25 outline-none focus:border-border-subtle/60 transition-colors"
          />
          <kbd className="absolute right-3 top-2 text-[10px] text-text-main/25 font-mono border border-border-subtle rounded px-1.5 py-0.5">&#8984;K</kbd>
        </div>
        <div className="flex bg-text-main/[0.03] border border-border-subtle rounded-lg p-0.5">
          {(['list', 'grid'] as const).map(v => (
            <button
              key={v}
              onClick={() => onViewModeChange(v)}
              className={cn(
                "w-8 h-7 rounded-md flex items-center justify-center transition-all",
                viewMode === v ? "bg-text-main/10 text-text-main" : "text-text-main/30 hover:text-text-main/60"
              )}
              title={v === 'list' ? listLabel : gridLabel}
              aria-label={v === 'list' ? listLabel : gridLabel}
            >
              {v === 'list' ? <LayoutList size={14} /> : <LayoutGrid size={14} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
