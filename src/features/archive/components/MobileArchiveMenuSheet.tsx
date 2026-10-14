import { useState } from 'react';
import { ChevronRight, Trash2, X } from 'lucide-react';
import { ModalShell } from '../../../shared/components/ModalShell';
import { IconButton } from '../../../shared/components/IconButton';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import type { SortMode } from './ArchiveHeader';

interface MobileArchiveMenuSheetProps {
  open: boolean;
  onClose: () => void;
  viewMode: 'list' | 'grid';
  onViewModeChange: (v: 'list' | 'grid') => void;
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
  sortLabels: Record<SortMode, string>;
  onOpenTags: () => void;
  onOpenCalendar: () => void;
  activeTab: 'notes' | 'trash';
  onTabChange: (t: 'notes' | 'trash') => void;
  trashCount: number;
  onClearTrash: () => void;
}

/** MR-8: один лист вместо шести рядов кнопок в шапке архива. */
export function MobileArchiveMenuSheet(props: MobileArchiveMenuSheetProps) {
  const {
    open, onClose, viewMode, onViewModeChange, sortMode, onSortModeChange, sortLabels,
    onOpenTags, onOpenCalendar, activeTab, onTabChange, trashCount, onClearTrash,
  } = props;
  const { t } = useLanguage();
  const [sortsOpen, setSortsOpen] = useState(false);
  const titleId = 'mobile-archive-menu-title';
  const sorts = Object.keys(sortLabels) as SortMode[];

  const row = 'w-full h-12 flex items-center gap-3 px-4 text-left text-sm text-text-main border-b border-border-subtle last:border-b-0';

  return (
    <ModalShell open={open} onClose={onClose} labelId={titleId} variant="sheet">
      <div className="flex flex-col min-h-0 flex-1">
        <h2 id={titleId} className="px-4 pt-4 pb-2 text-base font-bold text-text-main flex items-center justify-between gap-3">
          <span>{t('archive_more')}</span>
          <IconButton
            onClick={onClose}
            className="w-11 h-11 rounded-full border border-border-subtle flex items-center justify-center text-text-main/60"
            label={t('close')}
            icon={<X size={18} />}
          />
        </h2>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div role="group" aria-label={t('archive_menu_view')} className={row}>
            <span className="flex-1">{t('archive_menu_view')}</span>
            <span className="flex gap-1 p-0.5 rounded-lg bg-surface-elevated">
              {(['list', 'grid'] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onViewModeChange(v)}
                  aria-pressed={viewMode === v}
                  className={cn(
                    'h-11 px-3 rounded-md text-xs font-medium',
                    viewMode === v ? 'bg-brand-soft/20 text-brand-soft' : 'text-text-main/60'
                  )}
                >
                  {v === 'list' ? t('archive_list') : t('archive_grid')}
                </button>
              ))}
            </span>
          </div>

          <button type="button" onClick={() => setSortsOpen(o => !o)} className={row} aria-expanded={sortsOpen}>
            <span className="flex-1">{t('archive_menu_sort')}</span>
            <span className="text-[11px] text-text-main/55 truncate max-w-[45%]">{sortLabels[sortMode]}</span>
            <ChevronRight size={16} className={cn('shrink-0 transition-transform', sortsOpen && 'rotate-90')} />
          </button>
          {sortsOpen && sorts.map(m => (
            <button
              key={m}
              type="button"
              onClick={() => { onSortModeChange(m); setSortsOpen(false); }}
              className={cn(row, 'text-[13px]', m === sortMode ? 'text-brand-soft' : 'text-text-main/70')}
            >
              <span className="flex-1">{sortLabels[m]}</span>
            </button>
          ))}

          <button type="button" onClick={() => { onOpenTags(); onClose(); }} className={row}>
            <span className="flex-1">{t('archive_menu_tags')}</span>
            <ChevronRight size={16} className="shrink-0 text-text-main/45" />
          </button>

          <button type="button" onClick={() => { onOpenCalendar(); onClose(); }} className={row}>
            <span className="flex-1">{t('archive_menu_calendar')}</span>
            <ChevronRight size={16} className="shrink-0 text-text-main/45" />
          </button>

          {activeTab === 'notes' ? (
            <button type="button" onClick={() => { onTabChange('trash'); onClose(); }} className={row}>
              <span className="flex-1">{t('archive_tab_trash')}</span>
              <span className="text-[11px] text-text-main/55">
                {trashCount} · {t('archive_trash_days')}
              </span>
            </button>
          ) : (
            <>
              <button type="button" onClick={() => { onTabChange('notes'); onClose(); }} className={row}>
                <span className="flex-1">{t('archive_menu_back_to_notes')}</span>
              </button>
              <button type="button" onClick={() => { onClearTrash(); }} className={cn(row, 'text-accent-danger')}>
                <span className="flex-1">{t('archive_menu_clear_trash')}</span>
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
