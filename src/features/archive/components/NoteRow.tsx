import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { ExternalLink, Trash2, Pencil, MoreVertical } from 'lucide-react';
import { getSessionDate, cn } from '../../../core/utils/utils';
import { toDate, getDateLocale } from '../../../core/utils/dateUtils';
import { InlineTags } from './InlineTags';
import { StorageIcons } from '../../../shared/components/StorageIcons';
import { ArchiveSession } from '../types';
import { Label } from '../../../types';
import { highlightText, getSearchContext } from '../../../shared/utils/highlightText';
import { MobileNoteActionsSheet } from './MobileNoteActionsSheet';
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
}

function NoteRow({ session, onOpen, t, language, onDelete, onTagsChange, onStorageChange, onTitleChange, onDateChange, onLabelChange, userId, labels, allTags, searchQuery, aiProcessed: _aiProcessed, aiLoading: _aiLoading, onAIClick: _onAIClick }: NoteRowProps) {
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session.title || '');
  const [editingDateTime, setEditingDateTime] = useState(false);
  const [dateDraft, setDateDraft] = useState('');
  const [timeDraft, setTimeDraft] = useState('');
  const dtRef = React.useRef<HTMLDivElement>(null);
  const labelPopupRef = React.useRef<HTMLDivElement>(null);
  const [labelPopupOpen, setLabelPopupOpen] = useState(false);
  // fixed-position coords: popup renders in a portal so the archive scroll
  // container (Virtuoso / overflow-y-auto) can't clip it
  const [labelPopupPos, setLabelPopupPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    longPressTimerRef.current = setTimeout(() => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(60);
        } catch {
          // ignore
        }
      }
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

  const date = getSessionDate(session);
  const dateLabel = date
    ? format(date, 'd MMM yy', { locale: getDateLocale(language) })
    : '—';

  const timeStr = (() => {
    const d = toDate(session.sessionStartTime) ?? toDate(session.createdAt);
    return d ? d.toLocaleTimeString(language === 'ru' ? 'ru' : 'en', { hour: '2-digit', minute: '2-digit' }) : '00:00';
  })();

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

  React.useEffect(() => {
    if (!labelPopupOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (labelPopupRef.current && !labelPopupRef.current.contains(e.target as Node)) {
        setLabelPopupOpen(false);
      }
    };
    const close = () => setLabelPopupOpen(false);
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [labelPopupOpen]);

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

  return (
    <div
      className={cn("grid items-start gap-3 px-3 py-4 pr-5 rounded-xl hover:bg-text-main/[0.025] transition-colors group border border-transparent hover:border-border-subtle border-l-2 grid-cols-[72px_1fr_auto]", label ? "" : "border-l-transparent")}
      style={label ? { borderLeftColor: label.color, background: `color-mix(in srgb, ${label.color} 4%, transparent)`, boxShadow: `inset 3px 0 8px color-mix(in srgb, ${label.color} 15%, transparent)` } : undefined}
    >
      <div className="shrink-0 relative">
        <div
          className="cursor-pointer"
          onClick={openDateTimeEditor}
          title={t('archive_edit_date')}
        >
          <div className="font-mono text-label-sm text-text-main/60 uppercase tracking-wide leading-tight hover:text-text-main/70 tabular-nums">
            {dateLabel}
          </div>
          <div className="font-mono text-label-sm text-text-main/60 mt-0.5 hover:text-text-main/60 tabular-nums">
            {timeStr}
          </div>
        </div>
        {editingDateTime && (
          <div
            ref={dtRef}
            className={cn("absolute top-full left-0 z-50 mt-1 border border-border-subtle rounded-xl p-3 shadow-xl w-[200px]", "bg-[color-mix(in_srgb,var(--bg-base)_95%,var(--brand-primary)_5%)]")}
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
                className="flex-1 text-label-sm font-medium px-2 py-1.5 rounded-lg border border-border-subtle text-text-main/60 hover:text-text-main/60 transition-colors"
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
            className="text-[15px] font-medium text-text-main leading-snug truncate hover:text-brand-soft transition-colors"
            onClick={e => e.stopPropagation()}
            onDoubleClick={e => { e.stopPropagation(); setTitleDraft(session.title || ''); setEditingTitle(true); }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            title={t('archive_edit_title_hint')}
          >
            {highlightText(session.title || t('session_untitled'), searchQuery ?? '')}
          </div>
        )}
        {session.content && (
          <p className="text-sm text-text-main/60 leading-relaxed line-clamp-1 sm:line-clamp-2 mb-2 cursor-pointer text-pretty"  onClick={onOpen}>
            {highlightText(getSearchContext(session.content, searchQuery), searchQuery ?? '')}
          </p>
        )}
        <InlineTags
          tags={session.tags || []}
          onChange={(newTags) => onTagsChange?.(session, newTags)}
          allTags={allTags}
        />

      </div>

      <div className="flex items-center gap-1 shrink-0 pt-1" onClick={e => e.stopPropagation()}>
        {isMobile ? (
          <>
            <IconButton
              onClick={e => { e.stopPropagation(); setActionsSheetOpen(true); }}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-text-main/60 hover:bg-text-main/5 active:bg-text-main/10"
              label={t('archive_note_actions') || 'Actions'}
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
                  onRename={() => { setTitleDraft(session.title || ''); setEditingTitle(true); }}
                  onDelete={() => onDelete?.(session)}
                  onLabelChange={(labelId) => onLabelChange?.(session, labelId)}
                  onStorageChange={() => onStorageChange?.()}
                />
              )}
            </AnimatePresence>
          </>
        ) : (
          <>
            <div className="relative">
              <Button
                aria-expanded={labelPopupOpen}
                onClick={e => {
                  e.stopPropagation();
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const spaceBelow = window.innerHeight - rect.bottom;
                  const openUp = spaceBelow < 220 && rect.top > spaceBelow;
                  setLabelPopupPos({
                    left: Math.max(8, Math.min(rect.left, window.innerWidth - 166)),
                    ...(openUp
                      ? { bottom: window.innerHeight - rect.top + 4, maxHeight: rect.top - 12 }
                      : { top: rect.bottom + 4, maxHeight: spaceBelow - 12 }),
                  });
                  setLabelPopupOpen(!labelPopupOpen);
                }}
                className={cn("w-7 h-7 p-0 flex items-center justify-center rounded-lg transition-colors", label ? "" : "hover:bg-text-main/5")}
                title={label?.name ?? t('archive_assign_label')}
              >
                <div className={cn("w-4 h-4 rounded-full border-2 shrink-0 transition-colors", label ? "border-transparent" : "border-border-subtle group-hover:border-text-main/20")}
                  style={{ background: label?.color ?? 'transparent' }}
                />
              </Button>
              {labelPopupOpen && (labels && labels.length > 0 || session.labelId) && labelPopupPos && createPortal(
                <div
                  ref={labelPopupRef}
                  style={{ position: 'fixed', ...labelPopupPos }}
                  className={cn(
                    "z-50 border border-border-subtle rounded-xl p-1.5 shadow-xl min-w-[150px] backdrop-blur-xl overflow-y-auto",
                    "bg-[color-mix(in_srgb,var(--bg-base)_92%,var(--brand-primary)_8%)]"
                  )}
                  onClick={e => e.stopPropagation()}
                >
                  {session.labelId && (
                    <Button
                      onClick={e => { e.stopPropagation(); onLabelChange?.(session, undefined); setLabelPopupOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left justify-start whitespace-nowrap text-text-main/60 hover:bg-text-main/5 transition-colors"
                    >
                      <div className="w-3 h-3 rounded-full border border-dashed border-text-main/20 shrink-0" />
                      {t('archive_no_label')}
                    </Button>
                  )}
                  {labels?.map(l => (
                    <Button
                      key={l.id}
                      onClick={e => { e.stopPropagation(); onLabelChange?.(session, session.labelId === l.id ? undefined : l.id); setLabelPopupOpen(false); }}
                      className={cn("w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left justify-start whitespace-nowrap transition-colors", session.labelId === l.id ? "bg-text-main/10 text-text-main" : "text-text-main/60 hover:bg-text-main/5")}
                    >
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ background: l.color }} />
                      {l.name}
                    </Button>
                  ))}
                </div>,
                document.body
              )}
            </div>
            <IconButton onClick={e => { e.stopPropagation(); setTitleDraft(session.title || ''); setEditingTitle(true); }}
              className="w-9 h-9 md:w-7 md:h-7 flex items-center justify-center rounded-lg text-text-main/60 md:text-text-main/60 hover:text-text-main/60 hover:bg-text-main/5 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
              label={t('archive_rename_title')}
              icon={<Pencil size={14} aria-hidden="true" />}
            />
            <IconButton onClick={e => { e.stopPropagation(); onOpen(); }}
              className="w-9 h-9 md:w-7 md:h-7 flex items-center justify-center rounded-lg text-text-main/60 md:text-text-main/60 hover:text-text-main/60 hover:bg-text-main/5 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
              label={t('archive_preview')}
              icon={<ExternalLink size={14} aria-hidden="true" />}
            />
            <StorageIcons
              doc={{
                localId: session._isLocal ? session.id : undefined,
                cloudId: session._linkedCloudId,
                hasLocal: !!session._isLocal,
                hasCloud: !!session._hasCloudCopy,
                hasPendingSync: !!session._hasPendingSync,
              }}
              userId={userId}
              onStorageChange={() => onStorageChange?.()}
            />
            <IconButton onClick={e => { e.stopPropagation(); onDelete?.(session); }}
              className="w-9 h-9 md:w-7 md:h-7 flex items-center justify-center rounded-lg text-text-main/60 md:text-text-main/60 hover:text-accent-danger hover:bg-accent-danger/5 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
              label={t('archive_delete')}
              icon={<Trash2 size={14} aria-hidden="true" />}
            />
          </>
        )}
      </div>
    </div>
  );
}

const MemoizedNoteRow = React.memo(NoteRow);
export { MemoizedNoteRow as NoteRow };
