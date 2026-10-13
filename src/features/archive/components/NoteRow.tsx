import React, { useState } from 'react';
import { format } from 'date-fns';
import { Lock, AlertCircle, MoreHorizontal, MoreVertical } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { toDate, formatDateTimeLabel } from '../../../core/utils/dateUtils';
import { InlineTags } from './InlineTags';
import { StorageButtons } from './StorageButtons';
import { useNoteMenu } from './useNoteMenu';
import { Menu } from '../../../shared/components/Menu';
import { ArchiveSession } from '../types';
import { Label } from '../../../types';
import { highlightText, getSearchContext } from '../../../shared/utils/highlightText';
import { isBlankTitle } from '../../../shared/utils/titleUtils';
import { MobileNoteActionsSheet } from '../../../app/components/MobileNoteActionsSheet';
import { AnimatePresence } from 'motion/react';
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

  const handleTouchStart = (e: React.TouchEvent) => {
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
      setTitleDraft(session.title || '');
      setEditingTitle(true);
    }, 600);
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

  const startRename = () => {
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
      // Полоса метки слева и лёгкая подкраска строки её цветом — вернули по
      // просьбе владельца: метку видно краем глаза, точка терялась.
      className={cn("grid items-start gap-3 px-3 py-4 pr-3 rounded-xl hover:bg-text-main/[0.025] transition-colors group border border-transparent hover:border-border-subtle border-l-2 grid-cols-[auto_1fr_auto]", label ? "" : "border-l-transparent")}
      style={label ? { borderLeftColor: label.color, background: `color-mix(in srgb, ${label.color} 4%, transparent)`, boxShadow: `inset 3px 0 8px color-mix(in srgb, ${label.color} 15%, transparent)` } : undefined}
      onContextMenu={e => {
        if (isMobile) return;
        e.preventDefault();
        setMenuAnchor({ kind: 'point', x: e.clientX, y: e.clientY });
      }}
    >
      <div className="shrink-0 relative">
        <div
          className="cursor-pointer"
          onClick={openDateTimeEditor}
          title={t('archive_edit_date')}
        >
          {/* DC-A3: обычная Inter, tabular-nums, одна строка — не переносится. */}
          <div className="text-[13px] text-text-main/60 leading-tight hover:text-text-main/70 tabular-nums whitespace-nowrap">
            {dateTimeLabel}
          </div>
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
            onClick={session._locked || session._decryptionError ? onOpen : (e => {
              e.stopPropagation();
              // MB-11 (F-24): на телефоне одиночный тап по заголовку открывает
              // заметку. Двойной клик там не угадывается, а «Предпросмотр» в
              // листе действий — это не «открыть». Долгое нажатие остаётся
              // переименованием. Десктоп не тронут: там клик по заголовку
              // гасится намеренно (строка редактируется двойным кликом).
              if (!isMobile) return;
              if (longPressFiredRef.current) { longPressFiredRef.current = false; return; }
              onOpen();
            })}
            onDoubleClick={e => {
              if (session._locked || session._decryptionError) {
                onOpen();
                return;
              }
              e.stopPropagation();
              setTitleDraft(session.title || '');
              setEditingTitle(true);
            }}
            onTouchStart={session._locked || session._decryptionError ? undefined : handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            title={session._locked || session._decryptionError ? undefined : t('archive_edit_title_hint')}
          >
            {!session._isLocal && session._hasCloudCopy && (
              <span className="inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded bg-brand-soft/10 text-brand-soft shrink-0 border border-brand-soft/20">
                {t('archive_cloud_only')}
              </span>
            )}
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
                  const rawTitle = session.title?.trim();
                  const cleanTitle = !isBlankTitle(rawTitle) ? rawTitle : undefined;
                  const firstContentLine = session.content
                    ?.split('\n')
                    .map(l => l.trim())
                    .find(l => !isBlankTitle(l));
                  const isCloudOnly = !session._isLocal && session._hasCloudCopy;
                  const displayTitle = cleanTitle || firstContentLine || (isCloudOnly ? t('archive_cloud_only_note') : t('session_untitled'));
                  return highlightText(displayTitle, searchQuery ?? '');
                })()}
              </span>
            )}
          </div>
        )}
        {session.content && (
          <p className="text-sm text-text-main/60 leading-relaxed line-clamp-1 sm:line-clamp-2 mb-2 cursor-pointer text-pretty"  onClick={onOpen}>
            {highlightText(getSearchContext(session.content, searchQuery), searchQuery ?? '')}
          </p>
        )}
        <InlineTags
          variant="row"
          tags={session.tags || []}
          onChange={(newTags) => onTagsChange?.(session, newTags)}
          allTags={allTags}
          isAdding={tagInputOpen}
          onStartAdding={() => setTagInputOpen(true)}
          onStopAdding={() => setTagInputOpen(false)}
        />

      </div>

      <div className="flex items-center gap-1 shrink-0 pt-1" onClick={e => e.stopPropagation()}>
        {isMobile ? (
          <>
            <IconButton
              onClick={e => { e.stopPropagation(); setActionsSheetOpen(true); }}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-text-main/60 hover:bg-text-main/5 active:bg-text-main/10"
              label={t('archive_note_actions')}
              icon={<MoreVertical size={18} aria-hidden="true" />}
            />
            <AnimatePresence>
              {actionsSheetOpen && (
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
              )}
            </AnimatePresence>
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
