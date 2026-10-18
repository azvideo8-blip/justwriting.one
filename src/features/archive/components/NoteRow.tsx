import React, { useState } from 'react';
import { format } from 'date-fns';
import { Lock, AlertCircle, MoreHorizontal } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { toDate, formatDateTimeLabel } from '../../../core/utils/dateUtils';
import { InlineTags } from './InlineTags';
import { StorageButtons } from './StorageButtons';
import { useNoteMenu } from './useNoteMenu';
import { Menu } from '../../../shared/components/Menu';
import { ArchiveSession } from '../types';
import { Label } from '../../../types';
import { highlightText, getSearchContext } from '../../../shared/utils/highlightText';
import { deriveNoteTitle, splitNoteTitle } from './noteTitle';
import { MobileRenameSheet } from './MobileRenameSheet';
import { LabelMark } from './LabelMark';
import { StorageStateIcons } from './StorageStateIcons';
import { MobileNoteActionsSheet } from '../../../app/components/MobileNoteActionsSheet';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { Input } from '../../../shared/components/Input';

interface NoteRowProps {
  session: ArchiveSession;
  onOpen: () => void;
  t: (key: string) => string;
  language: string;
  onDelete?: ((session: ArchiveSession) => void) | undefined;
  onTagsChange?: ((session: ArchiveSession, tags: string[]) => void) | undefined;
  onStorageChange?: (() => void) | undefined;
  onTitleChange?: ((session: ArchiveSession, title: string) => void) | undefined;
  onDateChange?: ((session: ArchiveSession, date: Date) => void) | undefined;
  onLabelChange?: ((session: ArchiveSession, labelId: string | undefined) => void) | undefined;
  userId: string;
  labels?: Label[] | undefined;
  allTags?: string[] | undefined;
  searchQuery?: string | undefined;
  aiProcessed?: boolean | undefined;
  aiLoading?: boolean | undefined;
  onAIClick?: (() => void) | undefined;
  aiExclusionLoading?: boolean | undefined;
  onAIExclusionClick?: (() => void) | undefined;
}

function NoteRow({ session, onOpen, t, language, onDelete, onTagsChange, onStorageChange, onTitleChange, onDateChange, onLabelChange, userId, labels, allTags, searchQuery, aiProcessed, aiLoading, onAIClick, aiExclusionLoading, onAIExclusionClick }: NoteRowProps) {
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session.title || '');
  const [editingDateTime, setEditingDateTime] = useState(false);
  const [dateDraft, setDateDraft] = useState('');
  const [timeDraft, setTimeDraft] = useState('');
  const dtRef = React.useRef<HTMLDivElement>(null);
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const [tagInputOpen, setTagInputOpen] = useState(false);
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // MB-11: долгое нажатие открывает переименование, и по нему же надо подавить
  // «обычный» клик, иначе тот же палец открыл бы ещё и заметку.
  const longPressFiredRef = React.useRef(false);
  // MR-9: на телефоне долгое нажатие ведёт в лист действий, порог — 500 мс.
  const longPressMs = isMobile ? 500 : 600;

  const handleTouchStart = (e: React.TouchEvent) => {
    if (session._locked || session._decryptionError) return;
    e.stopPropagation();
    longPressFiredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(60);
        } catch {
          // ignore
        }
      }
      longPressFiredRef.current = true;
      if (isMobile) {
        setActionsSheetOpen(true);
      } else {
        setTitleDraft(session.title || '');
        setEditingTitle(true);
      }
    }, longPressMs);
  };

  const handleTouchMove = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  /** MR-9: на телефоне весь ряд — одна цель касания, открывающая заметку. */
  const handleRowTap = () => {
    if (longPressFiredRef.current) { longPressFiredRef.current = false; return; }
    onOpen();
  };

  // DC-A3: `getSessionDate` обнуляет время, поэтому метка строится от точного
  // момента заметки — дата и время одной строкой, без mono и без uppercase.
  const sessionTime = toDate(session.sessionStartTime) ?? toDate(session.createdAt);
  const dateTimeLabel = sessionTime ? formatDateTimeLabel(sessionTime, language) : '—';

  React.useEffect(() => {
    if (!editingDateTime) return;
    const handleClick = (e: MouseEvent) => {
      if (dtRef.current && !dtRef.current.contains(e.target as Node)) {
        setEditingDateTime(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [editingDateTime]);

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed !== (session.title || '') && trimmed) {
      onTitleChange?.(session, trimmed);
    } else {
      setTitleDraft(session.title || '');
    }
  };

  const openDateTimeEditor = () => {
    const ms = session.sessionStartTime
      ?? (session.createdAt instanceof Date ? session.createdAt.getTime() : Date.now());
    const d = new Date(ms);
    setDateDraft(format(d, 'yyyy-MM-dd'));
    setTimeDraft(format(d, 'HH:mm'));
    setEditingDateTime(true);
  };

  const commitDateTime = () => {
    setEditingDateTime(false);
    if (!dateDraft || !timeDraft) return;
    const [y, mo, d] = dateDraft.split('-').map(Number);
    const [h, min] = timeDraft.split(':').map(Number);
    if (y == null || mo == null || d == null || h == null || min == null) return;
    const newDate = new Date(y, mo - 1, d, h, min, 0, 0);
    if (isNaN(newDate.getTime())) return;
    const originalMs = session.sessionStartTime
      ?? (session.createdAt instanceof Date ? session.createdAt.getTime() : Date.now());
    if (newDate.getTime() !== originalMs) {
      onDateChange?.(session, newDate);
    }
  };

  const label = labels?.find(l => l.id === session.labelId);
  const mobileSplit = splitNoteTitle(session.title, session.content);

  // MF-11: на телефоне — общий лист переименования. Поле в строке теряло фокус,
  // когда закрывшийся лист действий возвращал его своей кнопке, и закрывалось.
  const [renameSheetOpen, setRenameSheetOpen] = useState(false);
  const startRename = () => {
    if (isMobile) { setRenameSheetOpen(true); return; }
    setTitleDraft(session.title || '');
    setEditingTitle(true);
  };

  const menu = useNoteMenu({
    session, userId, t, labels, onOpen, onRename: startRename,
    onAddTag: () => setTagInputOpen(true),
    onDelete, onLabelChange, onStorageChange,
    aiProcessed, aiLoading, onAIClick, aiExclusionLoading, onAIExclusionClick,
  });
  const menuAnchor = menu.anchor;
  const setMenuAnchor = menu.setAnchor;

  return (
    <div
      // U-34 (решение владельца 2026-10-18 по Q-5): цвет метки несёт полоса — на
      // обоих устройствах. 2026-09-30 владелец вернул её на десктопе («точку не
      // видно краем глаза»), MC-7 оставил на телефоне только подкраску. Имя метки
      // остаётся: полоса — цвет, слово — смысл.
      className={cn("grid items-start gap-3 px-3 py-4 pr-3 rounded-xl hover:bg-text-main/[0.025] transition-colors group border border-transparent hover:border-border-subtle grid-cols-[auto_1fr_auto]", "border-l-2", !label && "border-l-transparent", isMobile && "press min-h-[60px] active:bg-text-main/[0.04]")}
      style={label ? {
        borderLeftColor: label.color,
        background: `color-mix(in srgb, ${label.color} 4%, transparent)`,
        boxShadow: `inset 3px 0 8px color-mix(in srgb, ${label.color} 15%, transparent)`,
      } : undefined}
      onClick={isMobile ? handleRowTap : undefined}
      onTouchStart={isMobile ? handleTouchStart : undefined}
      onTouchMove={isMobile ? handleTouchMove : undefined}
      onTouchEnd={isMobile ? handleTouchEnd : undefined}
      onContextMenu={e => {
        if (isMobile) return;
        e.preventDefault();
        setMenuAnchor({ kind: 'point', x: e.clientX, y: e.clientY });
      }}
    >
      <div className="shrink-0 relative">
        <div
          className="cursor-pointer"
          onClick={isMobile ? undefined : openDateTimeEditor}
          title={isMobile ? undefined : t('archive_edit_date')}
        >
          {/* DC-A3: обычная Inter, tabular-nums, одна строка — не переносится.
              MR-9: на телефоне день уже назван группой строк, поэтому в колонке
              остаётся только время — шириной 44 px.
              U-21 (решение владельца 2026-10-18): кегль на телефоне — как на
              десктопе, 13 px; дату на телефон не переносим. */}
          <div className={cn(
            'leading-tight whitespace-nowrap text-text-main/60 hover:text-text-main/70',
            isMobile ? 'min-w-11 text-[13px] tabular-nums' : 'text-[13px] tabular-nums'
          )}>
            {isMobile ? (sessionTime ? format(sessionTime, 'HH:mm') : '—') : dateTimeLabel}
          </div>
          {/* MF-14: под временем — значки копий и разбора (индикаторы, не кнопки).
              U-21: тот же набор, порядок и состояния, что у десктопных `StorageButtons`. */}
          {isMobile && (
            <div className="mt-1.5">
              <StorageStateIcons
                cloud={!!session._hasCloudCopy}
                device={!!session._isLocal}
                analyzed={!!aiProcessed}
                pendingSync={!!session._hasPendingSync}
                excluded={!!session.excludedFromAI}
              />
            </div>
          )}
        </div>
        {editingDateTime && (
          <div
            ref={dtRef}
            className={cn("absolute top-full left-0 z-[var(--z-panel)] mt-1 border border-border-subtle rounded-xl p-3 shadow-xl w-[200px]", "bg-[color-mix(in_srgb,var(--bg-base)_95%,var(--brand-primary)_5%)]")}
          >
            <div className="space-y-2">
              <div>
                <label className="text-label font-mono text-text-main/60 uppercase tracking-wide">
                  {t('archive_edit_date')}
                </label>
                <Input
                  type="date"
                  aria-label={t('archive_edit_date')}
                  value={dateDraft}
                  onChange={e => setDateDraft(e.target.value)}
                  className="text-[12px] font-mono bg-text-main/5 border border-border-subtle rounded px-2 py-1 outline-none mt-0.5"
                />
              </div>
              <div>
                <label className="text-label font-mono text-text-main/60 uppercase tracking-wide">
                  {t('archive_edit_time')}
                </label>
                <Input
                  type="time"
                  aria-label={t('archive_edit_time')}
                  value={timeDraft}
                  onChange={e => setTimeDraft(e.target.value)}
                  className="text-[12px] font-mono bg-text-main/5 border border-border-subtle rounded px-2 py-1 outline-none mt-0.5"
                />
              </div>
              <div className="flex gap-2 pt-1">
              <Button
                onClick={commitDateTime}
                className="flex-1 text-label-sm font-medium px-2 py-1.5 rounded-lg bg-brand-soft/15 text-brand-soft hover:bg-brand-soft/25 transition-colors"
              >
                {t('common_save')}
              </Button>
              <Button
                onClick={() => setEditingDateTime(false)}
                className="flex-1 text-label-sm font-medium px-2 py-1.5 rounded-lg border border-border-subtle text-text-main/60 hover:text-text-main transition-colors"
              >
                {t('common_cancel')}
              </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="min-w-0">
        {editingTitle ? (
           <Input
             aria-label={t('editor_title_placeholder')}
             value={titleDraft}
             onChange={e => setTitleDraft(e.target.value)}
             onBlur={commitTitle}
             onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
             autoFocus
             onClick={e => e.stopPropagation()}
             className="text-[15px] font-medium text-text-main bg-text-main/5 border border-border-subtle rounded px-2 py-0.5 outline-none"
           />
        ) : (
          <div
            className={cn(
              "text-[15px] font-medium text-text-main leading-snug truncate transition-colors flex items-center gap-1.5",
              session._locked || session._decryptionError ? "cursor-pointer" : "hover:text-brand-soft"
            )}
            onClick={session._locked || session._decryptionError
              ? (e => { e.stopPropagation(); onOpen(); })
              // MR-9: открытие заметки на телефоне несёт весь ряд, поэтому здесь
              // ничего не гасится — гашение и было причиной «тап по заголовку
              // ничего не делает». Десктоп не тронут: клик по заголовку гасится
              // намеренно, строка редактируется двойным кликом.
              : (e => { if (!isMobile) e.stopPropagation(); })}
            onDoubleClick={e => {
              if (session._locked || session._decryptionError) {
                onOpen();
                return;
              }
              e.stopPropagation();
              setTitleDraft(session.title || '');
              setEditingTitle(true);
            }}
            // Десктопный макет на сенсорном экране (телефоны без мобильного
            // макета — почти все): долгое нажатие на заголовок открывает
            // переименование, как до MR-9. В мобильном макете касания несёт ряд.
            onTouchStart={isMobile || session._locked || session._decryptionError ? undefined : handleTouchStart}
            onTouchMove={isMobile ? undefined : handleTouchMove}
            onTouchEnd={isMobile ? undefined : handleTouchEnd}
            title={session._locked || session._decryptionError ? undefined : t('archive_edit_title_hint')}
          >
            {!isMobile && !session._isLocal && session._hasCloudCopy && (
              <span className="inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded bg-brand-soft/10 text-brand-soft shrink-0 border border-brand-soft/20">
                {t('archive_cloud_only')}
              </span>
            )}
            {/* Ревью 0.9.40: и на телефоне — единственный знак, что заметка не уходит в облако. */}
            {session._isTooLargeForSync && (
              <span
                className="inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-warning/10 text-accent-warning shrink-0 border border-accent-warning/20"
                title={t('storage_too_large_cloud')}
              >
                {t('archive_local_only_too_large')}
              </span>
            )}
            {session._locked ? (
              <span className="inline-flex items-center gap-1.5 text-text-main/70 italic">
                <Lock size={13} className="shrink-0 text-accent-warning/80" aria-label={t('archive_note_locked')} />
                <span className="truncate">{t('archive_note_locked')}</span>
              </span>
            ) : session._decryptionError ? (
              <span className="inline-flex items-center gap-1.5 text-accent-danger/80 italic">
                <AlertCircle size={13} className="shrink-0" aria-label={t('archive_decryption_error')} />
                <span className="truncate">{t('archive_decryption_error')}</span>
              </span>
            ) : (
              <span className="truncate">
                {(() => {
                  const isCloudOnly = !session._isLocal && session._hasCloudCopy;
                  const displayTitle = (isMobile ? mobileSplit.title : deriveNoteTitle(session.title, session.content)) || (isCloudOnly ? t('archive_cloud_only_note') : t('session_untitled'));
                  return highlightText(displayTitle, searchQuery ?? '');
                })()}
              </span>
            )}
          </div>
        )}
        {/* MF-16: на телефоне у заметки без названия превью идёт после выведенного
            названия — первая фраза не повторяется дважды. */}
        {(isMobile && !searchQuery ? mobileSplit.preview : session.content) && (
          <p className="text-sm text-text-main/60 leading-relaxed line-clamp-1 sm:line-clamp-2 mb-2 cursor-pointer text-pretty" onClick={isMobile ? undefined : onOpen}>
            {highlightText(isMobile && !searchQuery ? mobileSplit.preview : getSearchContext(session.content, searchQuery), searchQuery ?? '')}
          </p>
        )}
        {!isMobile || tagInputOpen ? (
          // На телефоне чипсы тегов видны только пока открыт ввод тега из листа
          // действий («Добавить тег») — иначе ряд остаётся текстовым.
          <InlineTags
            variant="row"
            tags={session.tags || []}
            onChange={(newTags) => onTagsChange?.(session, newTags)}
            allTags={allTags}
            isAdding={tagInputOpen}
            onStartAdding={() => setTagInputOpen(true)}
            onStopAdding={() => setTagInputOpen(false)}
          />
        ) : ((label || (session.tags?.length ?? 0) > 0) && (
          // MR-9: на телефоне теги — текст, а не цели касания: правка остаётся в
          // предпросмотре и в листе действий. MC-7: цвет — `--text-subtle`,
          // брендовый оставлен действиям, теги не должны перетягивать взгляд.
          // MF-13: перед тегами — метка точкой и именем её цвета.
          <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--text-subtle)]">
            {label && <LabelMark label={label} />}
            {label && (session.tags?.length ?? 0) > 0 && <span aria-hidden="true">·</span>}
            {(session.tags?.length ?? 0) > 0 && <span className="truncate font-mono">{session.tags!.map(tag => `#${tag}`).join(' ')}</span>}
          </p>
        ))}

      </div>

      <div className="flex items-center gap-1 shrink-0 pt-1" onClick={e => e.stopPropagation()}>
        {isMobile ? (
          <>
            <IconButton
              onClick={e => { e.stopPropagation(); setActionsSheetOpen(true); }}
              className="w-11 h-11 flex items-center justify-center rounded-lg text-text-main/60 hover:bg-text-main/5 active:bg-text-main/10"
              label={t('archive_note_actions')}
              icon={<MoreHorizontal size={20} aria-hidden="true" />}
            />
            {/* Лист рендерится порталом в body, но события React всплывают по
                дереву компонентов — до ряда. Клики гасит колонка выше, а касания
                нет: палец, задержанный в листе на полсекунды, заводил таймер
                долгого нажатия ряда, и следующий тап по ряду проглатывался
                (ревью 0.9.39). `contents` — без влияния на раскладку. */}
            <div className="contents" onTouchStart={e => e.stopPropagation()}>
            {/* MQ-5: листы смонтированы всегда — уход вниз играет сам лист (useExitLinger). */}
            <MobileNoteActionsSheet
                  isOpen={actionsSheetOpen}
                  onClose={() => setActionsSheetOpen(false)}
                  session={session}
                  userId={userId}
                  labels={labels}
                  onOpen={onOpen}
                  onRename={startRename}
                  onAddTag={() => setTagInputOpen(true)}
                  onDelete={() => onDelete?.(session)}
                  onLabelChange={(labelId) => onLabelChange?.(session, labelId)}
                  onStorageChange={() => onStorageChange?.()}
                  aiProcessed={aiProcessed}
                  aiLoading={aiLoading}
                  {...(onAIClick ? { onAIClick } : {})}
                  aiExclusionLoading={!!aiExclusionLoading}
                  {...(onAIExclusionClick ? { onAIExclusionClick } : {})}
                />
              <MobileRenameSheet
                open={renameSheetOpen}
                initialTitle={session.title || ''}
                onCancel={() => setRenameSheetOpen(false)}
                onSave={title => { if (title !== (session.title || '')) onTitleChange?.(session, title); setRenameSheetOpen(false); }}
              />
            </div>
          </>
        ) : (
          <>
            <StorageButtons doc={menu.doc} userId={userId} storage={menu.storage} ai={menu.ai} exclusion={menu.exclusion} />
            <IconButton
              size="sm"
              onClick={e => {
                e.stopPropagation();
                const el = e.currentTarget;
                const r = el.getBoundingClientRect();
                setMenuAnchor({
                  kind: 'trigger',
                  rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
                  trigger: el,
                });
              }}
              aria-haspopup="menu"
              aria-expanded={menuAnchor !== null}
              // G-6 (R3-035): приглушение одно — 60% из IconButton. Раньше /40
              // умножалось на opacity-60 и давало ~24%, ниже порога 3:1.
              className="w-7 h-7 group-hover:text-text-main group-focus-within:text-text-main"
              label={t('archive_note_actions')}
              icon={<MoreHorizontal size={16} aria-hidden="true" />}
            />
          </>
        )}
      </div>

      {menuAnchor !== null && (
        <Menu
          entries={menu.entries}
          anchor={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          label={t('archive_note_actions')}
        />
      )}
      {menu.storage.dialogs}
    </div>
  );
}

const MemoizedNoteRow = React.memo(NoteRow);
export { MemoizedNoteRow as NoteRow };
