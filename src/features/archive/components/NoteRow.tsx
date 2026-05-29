import React, { useState } from 'react';
import { format } from 'date-fns';
import { ExternalLink, Trash2, Pencil, MoreVertical, Sparkles } from 'lucide-react';
import { getSessionDate, cn } from '../../../core/utils/utils';
import { toDate, getDateLocale } from '../../../core/utils/dateUtils';
import { InlineTags } from './InlineTags';
import { StorageIcons } from '../../writing/components/StorageIcons';
import { ArchiveSession } from '../types';
import { Label } from '../../../types';
import { highlightText, getSearchContext } from '../../../shared/utils/highlightText';
import { MobileNoteActionsSheet } from './MobileNoteActionsSheet';
import { AnimatePresence } from 'motion/react';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';

interface NoteRowProps {
  session: ArchiveSession;
  onOpen: () => void;
  t: (key: string) => string;
  language: string;
  onDelete?: (session: ArchiveSession) => void;
  onTagsChange?: (session: ArchiveSession, tags: string[]) => void;
  onStorageChange?: () => void;
  onTitleChange?: (session: ArchiveSession, title: string) => void;
  onDateChange?: (session: ArchiveSession, date: Date) => void;
  onLabelChange?: (session: ArchiveSession, labelId: string | undefined) => void;
  userId: string;
  labels?: Label[];
  allTags?: string[];
  searchQuery?: string;
  aiProcessed?: boolean;
  onAIClick?: () => void;
}

function NoteRow({ session, onOpen, t, language, onDelete, onTagsChange, onStorageChange, onTitleChange, onDateChange, onLabelChange, userId, labels, allTags, searchQuery, aiProcessed, onAIClick }: NoteRowProps) {
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
  const [labelOpenUp, setLabelOpenUp] = useState(false);
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    longPressTimerRef.current = setTimeout(() => {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
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
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
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
      className={cn("grid items-start gap-3 px-3 py-4 pr-5 rounded-xl hover:bg-text-main/[0.025] transition-colors group border border-transparent hover:border-border-subtle border-l-2", label ? "" : "border-l-transparent")}
      style={{ gridTemplateColumns: '72px 1fr auto', ...(label ? { borderLeftColor: label.color, background: `color-mix(in srgb, ${label.color} 4%, transparent)`, boxShadow: `inset 3px 0 8px color-mix(in srgb, ${label.color} 15%, transparent)` } : {}) }}
    >
      <div className="shrink-0 relative">
        <div
          className="cursor-pointer"
          onClick={openDateTimeEditor}
          title={t('archive_edit_date')}
        >
          <div className="font-mono text-label-sm text-text-main/50 uppercase tracking-wide leading-tight hover:text-text-main/70 tabular-nums">
            {dateLabel}
          </div>
          <div className="font-mono text-label-sm text-text-main/30 mt-0.5 hover:text-text-main/50 tabular-nums">
            {timeStr}
          </div>
        </div>
        {editingDateTime && (
          <div
            ref={dtRef}
            className="absolute top-full left-0 z-50 mt-1 border border-border-subtle rounded-xl p-3 shadow-xl w-[200px]"
            style={{ background: 'color-mix(in srgb, var(--bg-base) 95%, var(--brand-primary) 5%)' }}
          >
            <div className="space-y-2">
              <div>
                <label className="text-label font-mono text-text-main/40 uppercase tracking-wide">
                  {t('archive_edit_date')}
                </label>
                <input
                  type="date"
                  value={dateDraft}
                  onChange={e => setDateDraft(e.target.value)}
                  className="w-full text-[12px] font-mono bg-text-main/5 border border-border-subtle rounded px-2 py-1 outline-none mt-0.5"
                />
              </div>
              <div>
                <label className="text-label font-mono text-text-main/40 uppercase tracking-wide">
                  {t('archive_edit_time')}
                </label>
                <input
                  type="time"
                  value={timeDraft}
                  onChange={e => setTimeDraft(e.target.value)}
                  className="w-full text-[12px] font-mono bg-text-main/5 border border-border-subtle rounded px-2 py-1 outline-none mt-0.5"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={commitDateTime}
                  className="flex-1 text-label-sm font-medium px-2 py-1.5 rounded-lg bg-brand-soft/15 text-brand-soft hover:bg-brand-soft/25 transition-colors"
                >
                  {t('common_save')}
                </button>
                <button
                  onClick={() => setEditingDateTime(false)}
                  className="flex-1 text-label-sm font-medium px-2 py-1.5 rounded-lg border border-border-subtle text-text-main/40 hover:text-text-main/60 transition-colors"
                >
                  {t('common_cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="min-w-0">
        {editingTitle ? (
          <input
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
            autoFocus
            onClick={e => e.stopPropagation()}
            className="text-[15px] font-medium text-text-main bg-text-main/5 border border-border-subtle rounded px-2 py-0.5 outline-none w-full"
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
          <p className="text-sm text-text-main/60 leading-relaxed line-clamp-1 sm:line-clamp-2 mb-2 cursor-pointer" style={{ textWrap: 'pretty' }} onClick={onOpen}>
            {highlightText(getSearchContext(session.content, searchQuery), searchQuery ?? '')}
          </p>
        )}
        <InlineTags
          tags={session.tags || []}
          onChange={(newTags) => onTagsChange?.(session, newTags)}
          allTags={allTags}
        />
        <button
          onClick={e => { e.stopPropagation(); onAIClick?.(); }}
          className={cn(
            "inline-flex items-center gap-1 ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors",
            aiProcessed
              ? "bg-brand-soft/10 text-brand-soft border-brand-soft/30 hover:bg-brand-soft/20"
              : "bg-text-main/3 text-text-main/40 border-border-subtle hover:text-brand-soft hover:bg-brand-soft/5 hover:border-brand-soft/30"
          )}
          title={aiProcessed ? 'Обработано ИИ (посмотреть чат)' : 'Обработать с помощью ИИ'}
        >
          <Sparkles size={10} />
          AI
        </button>
      </div>

      <div className="flex items-center gap-1 shrink-0 pt-1" onClick={e => e.stopPropagation()}>
        {isMobile ? (
          <>
            <button
              onClick={e => { e.stopPropagation(); setActionsSheetOpen(true); }}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-text-main/60 hover:bg-text-main/5 active:bg-text-main/10"
              title={t('archive_note_actions') || 'Actions'}
            >
              <MoreVertical size={18} />
            </button>
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
              <button
                onClick={e => {
                  e.stopPropagation();
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const spaceBelow = window.innerHeight - rect.bottom;
                  setLabelOpenUp(spaceBelow < 220);
                  setLabelPopupOpen(!labelPopupOpen);
                }}
                className={cn("w-7 h-7 flex items-center justify-center rounded-lg transition-colors", label ? "" : "hover:bg-text-main/5")}
                title={label?.name ?? t('archive_assign_label')}
              >
                <div className={cn("w-4 h-4 rounded-full border-2 transition-colors", label ? "border-transparent" : "border-border-subtle group-hover:border-text-main/20")}
                  style={{ background: label?.color ?? 'transparent' }}
                />
              </button>
              {labelPopupOpen && (labels && labels.length > 0 || session.labelId) && (
                <div
                  ref={labelPopupRef}
                  className={cn(
                    "absolute right-0 z-50 border border-border-subtle rounded-xl p-1.5 shadow-xl min-w-[150px] backdrop-blur-xl",
                    labelOpenUp ? "bottom-full mb-1" : "top-full mt-1"
                  )}
                  style={{ background: 'color-mix(in srgb, var(--bg-base) 92%, var(--brand-primary) 8%)' }}
                  onClick={e => e.stopPropagation()}
                >
                  {session.labelId && (
                    <button
                      onClick={e => { e.stopPropagation(); onLabelChange?.(session, undefined); setLabelPopupOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left text-text-main/40 hover:bg-text-main/5 transition-colors"
                    >
                      <div className="w-3 h-3 rounded-full border border-dashed border-text-main/20 shrink-0" />
                      {t('archive_no_label')}
                    </button>
                  )}
                  {labels?.map(l => (
                    <button
                      key={l.id}
                      onClick={e => { e.stopPropagation(); onLabelChange?.(session, session.labelId === l.id ? undefined : l.id); setLabelPopupOpen(false); }}
                      className={cn("w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left transition-colors", session.labelId === l.id ? "bg-text-main/10 text-text-main" : "text-text-main/60 hover:bg-text-main/5")}
                    >
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ background: l.color }} />
                      {l.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={e => { e.stopPropagation(); setTitleDraft(session.title || ''); setEditingTitle(true); }}
              className="w-9 h-9 md:w-7 md:h-7 flex items-center justify-center rounded-lg text-text-main/40 md:text-text-main/20 hover:text-text-main/60 hover:bg-text-main/5 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
              title={t('archive_rename_title')}>
              <Pencil size={14} />
            </button>
            <button onClick={e => { e.stopPropagation(); onOpen(); }}
              className="w-9 h-9 md:w-7 md:h-7 flex items-center justify-center rounded-lg text-text-main/40 md:text-text-main/20 hover:text-text-main/60 hover:bg-text-main/5 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
              title={t('archive_preview')}>
              <ExternalLink size={14} />
            </button>
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
            <button onClick={e => { e.stopPropagation(); onDelete?.(session); }}
              className="w-9 h-9 md:w-7 md:h-7 flex items-center justify-center rounded-lg text-text-main/30 md:text-text-main/25 hover:text-red-400 hover:bg-red-400/5 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
              title={t('archive_delete')}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const MemoizedNoteRow = React.memo(NoteRow);
export { MemoizedNoteRow as NoteRow };
