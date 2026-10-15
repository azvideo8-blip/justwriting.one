import { useState } from 'react';
import { Download, Pencil, X } from 'lucide-react';
import { useLanguage } from '../../shared/i18n';
import { Label } from '../../types';
import { cn } from '../../core/utils/utils';
import { Button } from '../../shared/components/Button';
import { IconButton } from '../../shared/components/IconButton';
import { ModalShell } from '../../shared/components/ModalShell';
import { buildNoteActions, type NoteActionId, type NoteActionItem, type NoteLabelsSection } from '../../features/archive/components/noteActions';
import { splitNoteTitle } from '../../features/archive/components/noteTitle';
import type { ArchiveSession } from '../../features/archive/types';
import { exportAsDocx, exportAsMd, exportAsTxt, isExportable, type ExportStrings } from '../../core/services/ArchiveExportService';
import { useToast } from '../../shared/components/Toast';
import { useNoteStorageActions } from '../../features/archive/components/useNoteStorageActions';

interface MobileNoteActionsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  session: ArchiveSession;
  userId: string;
  labels?: Label[] | undefined;
  onOpen: () => void;
  /** MF-12: подпись первого пункта — в читалке «Продолжить писать», в списке «Открыть». */
  openLabel?: string | undefined;
  /** Карандаш у названия — общий лист переименования (MF-11). */
  onRename: () => void;
  /** Открывает поле тега — в строке списка или в «Инфо» читалки. */
  onAddTag?: (() => void) | undefined;
  onDelete: () => void;
  onLabelChange: (labelId: string | undefined) => void;
  onStorageChange: () => void;
  /** Разбор заметки ИИ — тот же обработчик, что у кнопки ✨ в списке. */
  aiProcessed?: boolean | undefined;
  aiLoading?: boolean | undefined;
  onAIClick?: (() => void) | undefined;
  aiExclusionLoading?: boolean | undefined;
  onAIExclusionClick?: (() => void) | undefined;
}

// MF-12: порядок листа на телефоне. Строка «Изменить название» ушла в карандаш
// у названия, «Скопировать как» — в «Сохранить как…»; на десктопе меню прежнее.
const ORDER: NoteActionId[] = ['open', 'addTag', 'download', 'upload', 'removeLocal', 'removeCloud', 'excludeAi', 'analyzeAi'];

/** Лист действий на телефоне — один и тот же для списка, сетки и читалки.
 *  DC-A3: пункты строит та же `buildNoteActions`, что меню «⋯» на десктопе. */
export function MobileNoteActionsSheet({
  isOpen, onClose, session, userId, labels, onOpen, openLabel, onRename, onAddTag, onDelete,
  onLabelChange, onStorageChange, aiProcessed, aiLoading, onAIClick, aiExclusionLoading, onAIExclusionClick,
}: MobileNoteActionsSheetProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [saveAsOpen, setSaveAsOpen] = useState(false);

  const doc = {
    localId: session._isLocal ? session.id : undefined,
    cloudId: session._linkedCloudId,
    hasLocal: !!session._isLocal,
    hasCloud: !!session._hasCloudCopy,
    hasPendingSync: !!session._hasPendingSync,
    isTooLargeForSync: !!session._isTooLargeForSync,
    localOnly: !!session._localOnly,
  };

  const exclusion = onAIExclusionClick
    ? { excluded: !!session.excludedFromAI, loading: !!aiExclusionLoading, onClick: onAIExclusionClick }
    : undefined;
  const storage = useNoteStorageActions({ doc, userId, onStorageChange, ...(exclusion ? { exclusion } : {}) });

  const sections = buildNoteActions({
    t, doc, userId, storage, labels,
    currentLabelId: session.labelId,
    onLabelChange,
    onOpen: () => { onOpen(); onClose(); },
    ...(openLabel ? { openLabel } : {}),
    onRename: () => { onRename(); onClose(); },
    ...(onAddTag ? { onAddTag: () => { onAddTag(); onClose(); } } : {}),
    ...(onAIClick ? { ai: { processed: !!aiProcessed, loading: !!aiLoading, onClick: onAIClick } } : {}),
    ...(exclusion ? { exclusion } : {}),
    onDelete: () => { onDelete(); onClose(); },
  });
  const byId = (id: NoteActionId) => sections.find((x): x is NoteActionItem => x.kind === 'action' && x.id === id);
  const labelsSection = sections.find((x): x is NoteLabelsSection => x.kind === 'labels');
  const deleteItem = byId('delete');

  const exportStrings: ExportStrings = {
    date: t('export_header_date'), words: t('export_header_words'), time: t('export_header_time'),
    tags: t('export_header_tags'), untitled: t('export_untitled'), untitledFilename: t('export_filename_default'),
  };
  // Тот же отказ, что в десктопном превью: нечитаемую заметку не сохраняем пустым файлом.
  const runExport = (fn: () => void | Promise<void>) => {
    if (!isExportable(session)) {
      showToast(session._contentNotLoaded ? t('archive_export_not_loaded')
        : session._locked ? t('archive_export_locked') : t('archive_export_encrypted_unavailable'), 'error');
      return;
    }
    void fn();
    onClose();
  };
  // PDF на телефоне не предлагается: мобильная ветка exportAsPdf отдаёт .html
  // через «Поделиться», окна печати там нет (MF-12, отчёт).
  const formats = [
    { key: 'txt', label: t('export_txt'), run: () => runExport(() => exportAsTxt(session, exportStrings)) },
    { key: 'md', label: t('export_md'), run: () => runExport(() => exportAsMd(session, exportStrings)) },
    { key: 'docx', label: t('export_docx'), run: () => runExport(() => exportAsDocx(session, exportStrings)) },
  ];

  const rowClass = (destructive = false) => cn(
    'w-full min-h-[48px] flex items-center gap-3 px-4 py-3 rounded-2xl text-sm text-left font-medium transition-colors border',
    destructive
      ? 'text-accent-danger bg-accent-danger/10 border-accent-danger/20 active:bg-accent-danger/20'
      : 'text-text-main/80 bg-text-main/[0.02] border-border-subtle active:bg-text-main/[0.06]',
  );
  const row = (section: NoteActionItem) => {
    const Icon = section.icon;
    return (
      <Button key={section.id} data-action={section.id} onClick={section.onSelect} className={rowClass(section.destructive)}>
        <Icon size={18} className={section.destructive ? undefined : 'text-text-main/60'} aria-hidden="true" />
        <span>{section.label}</span>
      </Button>
    );
  };

  if (!isOpen) return null;
  const title = splitNoteTitle(session.title, session.content).title ?? t('common_untitled');

  return (
    <ModalShell open={isOpen} onClose={onClose} labelId="note-actions-sheet-title" variant="sheet">
      <h3 id="note-actions-sheet-title" className="sr-only">{t('archive_note_actions')}</h3>
      {/* MF-12: шапка — то же название, что в списке, и карандаш вместо строки «Изменить название». */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-border-subtle">
        <div className="min-w-0 flex-1 truncate pl-2 text-base font-bold text-text-main">{title}</div>
        <IconButton onClick={() => { onRename(); onClose(); }} className="w-11 h-11 rounded-full text-text-main/70" label={t('archive_rename_title')} icon={<Pencil size={18} />} />
        <IconButton onClick={onClose} className="w-11 h-11 rounded-full text-text-main/60" label={t('close')} icon={<X size={18} />} />
      </div>

      <div data-testid="note-actions-list" className="px-6 py-5 overflow-y-auto no-scrollbar space-y-2 pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
        {saveAsOpen ? (
          <div className="space-y-2" data-testid="note-save-as">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-text-muted">{t('archive_save_as')}</span>
              <Button onClick={() => setSaveAsOpen(false)} className="min-h-11 px-2 text-xs text-brand-soft">{t('writing_back')}</Button>
            </div>
            {formats.map(f => (
              <Button key={f.key} data-format={f.key} onClick={f.run} className={rowClass()}>
                <Download size={18} className="text-text-main/60" aria-hidden="true" />
                <span>{f.label}</span>
              </Button>
            ))}
          </div>
        ) : (
          <>
            {ORDER.map(id => {
              const item = byId(id);
              const out = item ? [row(item)] : [];
              // Метки — сразу после «Добавить тег» (или после первого пункта, если тега нет).
              if (labelsSection && (id === 'addTag' || (id === 'open' && !byId('addTag')))) {
                out.push(
                  <div key="labels" data-testid="note-actions-labels" className="pt-1">
                    <div className="px-1 pb-1 text-[13px] font-semibold text-text-muted">{labelsSection.heading}</div>
                    <div className="flex flex-wrap gap-2">
                      {labelsSection.options.map(o => (
                        <Button
                          key={o.key}
                          onClick={() => { o.onSelect(); onClose(); }}
                          aria-pressed={o.checked}
                          className={cn('min-h-11 inline-flex items-center gap-2 rounded-full border px-3 text-[13px]', o.checked ? 'border-text-main/30 bg-text-main/10 text-text-main' : 'border-border-subtle text-text-main/70')}
                        >
                          {o.dashed
                            ? <span className="w-3 h-3 rounded-full border border-dashed border-text-main/30" />
                            : <span className="w-3 h-3 rounded-full" style={o.color ? { backgroundColor: o.color } : undefined} />}
                          {o.label}
                        </Button>
                      ))}
                    </div>
                  </div>,
                );
              }
              return out;
            })}
            <Button data-action="saveAs" onClick={() => setSaveAsOpen(true)} className={rowClass()}>
              <Download size={18} className="text-text-main/60" aria-hidden="true" />
              <span>{t('archive_save_as')}</span>
            </Button>
            {deleteItem && (
              <div data-testid="note-actions-danger" className="mt-5 space-y-2">{row(deleteItem)}</div>
            )}
          </>
        )}
      </div>

      {storage.dialogs}
    </ModalShell>
  );
}
