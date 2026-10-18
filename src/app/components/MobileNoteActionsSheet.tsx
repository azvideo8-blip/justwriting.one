import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useExitLinger } from '../../shared/hooks/useExitLinger';
import { Download, Pencil, X } from 'lucide-react';
import { useLanguage } from '../../shared/i18n';
import { Label } from '../../types';
import { cn } from '../../core/utils/utils';
import { Button } from '../../shared/components/Button';
import { IconButton } from '../../shared/components/IconButton';
import { ModalShell, SECTION_LABEL, SHEET_DIVIDER, SHEET_ROW } from '../../shared/components/ModalShell';
import { buildNoteActions, type NoteActionId, type NoteActionItem, type NoteLabelsSection } from '../../features/archive/components/noteActions';
import { splitNoteTitle } from '../../features/archive/components/noteTitle';
import type { ArchiveSession } from '../../features/archive/types';
import { exportAsDocx, exportAsMd, exportAsTxt, isExportable, type ExportStrings } from '../../core/services/ArchiveExportService';
import { loadSessionContent } from '../../core/services/UnifiedSessionLoader';
import { reportError } from '../../shared/errors/reportError';
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
export function MobileNoteActionsSheet(props: MobileNoteActionsSheetProps) {
  // MQ-5: смонтирован всегда, тело живёт ещё 250 мс после закрытия — лист уходит вниз.
  return useExitLinger(props.isOpen) ? <MobileNoteActionsSheetBody {...props} /> : null;
}

function MobileNoteActionsSheetBody({
  isOpen, onClose, session, userId, labels, onOpen, openLabel, onRename, onAddTag, onDelete,
  onLabelChange, onStorageChange, aiProcessed, aiLoading, onAIClick, aiExclusionLoading, onAIExclusionClick,
}: MobileNoteActionsSheetProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  // N-8: пол высоты для вложенного вида. Меряется в момент нажатия, а не эффектом:
  // обработчик имеет право на setState, а эффект с синхронным setState — нет.
  const listRef = useRef<HTMLDivElement>(null);
  const [actionsHeight, setActionsHeight] = useState(0);
  const openSaveAs = () => {
    const el = listRef.current;
    if (el) setActionsHeight(el.scrollHeight);
    setSaveAsOpen(true);
  };

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
  // Тот же отказ, что в десктопном превью: нечитаемую заметку не сохраняем пустым
  // файлом. R7F-023: причина обязана быть настоящей — запертую заметку лист
  // показывает как запертую (прежний порядок проверял `_contentNotLoaded`, а
  // useArchiveSessions ставит его и запертым тоже); незагруженный облачный текст
  // докачивается, как это делает десктоп; и провал экспорта виден человеком, а не
  // только в консоли — `void fn()` выбрасывал промис вместе с неудачей.
  const runExport = async (fn: (target: ArchiveSession) => Promise<void> | void) => {
    let target = session;
    if (target._locked) {
      showToast(t('archive_export_locked'), 'error');
      return;
    }
    if (target._contentNotLoaded && !target._isLocal) {
      try {
        target = { ...target, ...(await loadSessionContent(userId, target.id)) };
      } catch (e) {
        reportError(e, { action: 'noteActionsSheet_loadForExport', id: target.id });
      }
      if (target._locked) {
        showToast(t('archive_export_locked'), 'error');
        return;
      }
    }
    if (!isExportable(target)) {
      showToast(target._contentNotLoaded ? t('archive_export_not_loaded') : t('archive_export_encrypted_unavailable'), 'error');
      return;
    }
    try {
      await fn(target);
    } catch (e) {
      reportError(e, { action: 'noteActionsSheet_export', id: target.id });
      showToast(t('archive_export_failed'), 'error');
    }
    onClose();
  };
  // PDF на телефоне не предлагается: мобильная ветка exportAsPdf отдаёт .html
  // через «Поделиться», окна печати там нет (MF-12, отчёт).
  const formats = [
    { key: 'txt', label: t('export_txt'), run: () => runExport(s => exportAsTxt(s, exportStrings)) },
    { key: 'md', label: t('export_md'), run: () => runExport(s => exportAsMd(s, exportStrings)) },
    { key: 'docx', label: t('export_docx'), run: () => runExport(s => exportAsDocx(s, exportStrings)) },
  ];

  // SA-17: строки меню на всю ширину — значок и текст слева, без рамок; пять
  // одинаковых карточек подряд читались как форма, а не как меню.
  // U-22 (решение владельца 2026-10-18): строка листа — общая `SHEET_ROW`; от
  // неё остаются только скругление и внутренний отступ этой панели.
  const rowClass = (destructive = false) => cn(
    SHEET_ROW, 'justify-start px-2 rounded-xl',
    destructive && 'text-accent-danger active:bg-accent-danger/10',
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

  const title = splitNoteTitle(session.title, session.content).title ?? t('common_untitled');

  return (
    <ModalShell open={isOpen} onClose={onClose} labelId="note-actions-sheet-title" variant="sheet">
      <h2 id="note-actions-sheet-title" className="sr-only">{t('archive_note_actions')}</h2>
      {/* MF-12: шапка — то же название, что в списке, и карандаш вместо строки «Изменить название». */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-border-subtle">
        {/* MQ-17: две строки вместо обрезки на 16 знаках. */}
        <div className="min-w-0 flex-1 line-clamp-2 break-words pl-2 text-base font-bold text-text-main">{title}</div>
        <IconButton onClick={() => { onRename(); onClose(); }} className="w-11 h-11 rounded-full text-text-main/70" label={t('archive_rename_title')} icon={<Pencil size={18} />} />
        <IconButton onClick={onClose} className="w-11 h-11 rounded-xl" label={t('close')} icon={<X size={18} />} />
      </div>

      <div data-testid="note-actions-list" ref={listRef} className="px-4 py-3 overflow-y-auto no-scrollbar pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
        {/* N-8 (emil-review, хвост MQ-15): «Сохранить как…» подменяла содержимое
            листа в один кадр, и высота рывком падала с десяти строк до четырёх.
            Кроссфейд по прозрачности в одной ячейке grid: обе ветки лежат друг на
            друге на 150 мс, поэтому высота не прыгает, а режим sync (не `wait`)
            не зависит от того, доиграет ли уход — `wait` без WAAPI вообще не
            монтирует следующую ветку. */}
        <div className="grid">
        <AnimatePresence initial={false}>
        {saveAsOpen ? (
          <motion.div key="save-as" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="col-start-1 row-start-1 space-y-2" data-testid="note-save-as" style={{ minHeight: actionsHeight || undefined }}>
            <div className="flex items-center justify-between">
              <span className={SECTION_LABEL}>{t('archive_save_as')}</span>
              <Button onClick={() => setSaveAsOpen(false)} className="min-h-11 px-2 text-xs text-brand-soft">{t('writing_back')}</Button>
            </div>
            {formats.map(f => (
              <Button key={f.key} data-format={f.key} onClick={() => { void f.run(); }} className={rowClass()}>
                <Download size={18} className="text-text-main/60" aria-hidden="true" />
                <span>{f.label}</span>
              </Button>
            ))}
          </motion.div>
        ) : (
          <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="col-start-1 row-start-1" data-testid="note-actions-main">
            {ORDER.map(id => {
              const item = byId(id);
              const out = item ? [row(item)] : [];
              // Метки — сразу после «Добавить тег» (или после первого пункта, если тега нет).
              if (labelsSection && (id === 'addTag' || (id === 'open' && !byId('addTag')))) {
                out.push(
                  <div key="labels" data-testid="note-actions-labels" className="pt-1">
                    <div className={`px-1 pb-1 ${SECTION_LABEL}`}>{labelsSection.heading}</div>
                    <div className="flex flex-wrap gap-2">
                      {labelsSection.options.map(o => (
                        <Button
                          key={o.key}
                          onClick={() => { o.onSelect(); onClose(); }}
                          aria-pressed={o.checked}
                          className={cn('min-h-11 inline-flex items-center gap-2 rounded-full border border-border-subtle px-3 text-[13px] text-text-main/70', o.checked && 'ring-2 ring-brand-soft text-text-main')}
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
            <Button data-action="saveAs" onClick={openSaveAs} className={rowClass()}>
              <Download size={18} className="text-text-main/60" aria-hidden="true" />
              <span>{t('archive_save_as')}</span>
            </Button>
            {deleteItem && (
              <div data-testid="note-actions-danger" className="mt-1 flex flex-col">
                <div role="separator" className={SHEET_DIVIDER} />
                {row(deleteItem)}
              </div>
            )}
          </motion.div>
        )}
        </AnimatePresence>
        </div>
      </div>

      {storage.dialogs}
    </ModalShell>
  );
}
