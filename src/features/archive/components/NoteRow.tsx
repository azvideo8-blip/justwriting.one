import React, { useState } from 'react';
import { format } from 'date-fns';
import { ExternalLink, Trash2, Pencil } from 'lucide-react';
import { getSessionDate, cn } from '../../../core/utils/utils';
import { toDate, getDateLocale } from '../../../core/utils/dateUtils';
import { InlineTags } from './InlineTags';
import { StorageIcons } from '../../writing/components/StorageIcons';
import { ArchiveSession } from '../types';
import { Label } from '../../../types';
import { highlightText } from '../../../shared/utils/highlightText';

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
}

function NoteRow({ session, onOpen, t, language, onDelete, onTagsChange, onStorageChange, onTitleChange, onDateChange, onLabelChange, userId, labels, allTags, searchQuery }: NoteRowProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session.title || '');
  const [editingDateTime, setEditingDateTime] = useState(false);
  const [dateDraft, setDateDraft] = useState('');
  const [timeDraft, setTimeDraft] = useState('');
  const dtRef = React.useRef<HTMLDivElement>(null);
  const labelPopupRef = React.useRef<HTMLDivElement>(null);
  const [labelPopupOpen, setLabelPopupOpen] = useState(false);

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
      className={cn("grid items-start gap-3 px-3 py-4 rounded-xl hover:bg-text-main/[0.025] transition-colors group border border-transparent hover:border-border-subtle border-l-2", label ? "" : "border-l-transparent")}
      style={{ gridTemplateColumns: '72px 1fr auto', ...(label ? { borderLeftColor: label.color, background: `color-mix(in srgb, ${label.color} 4%, transparent)`, boxShadow: `inset 3px 0 8px color-mix(in srgb, ${label.color} 15%, transparent)` } : {}) }}
    >
      <div className="shrink-0 relative">
        <div
          className="cursor-pointer"
          onClick={openDateTimeEditor}
          title={t('archive_edit_date')}
        >
          <div className="font-mono text-[11px] text-text-main/50 uppercase tracking-wide leading-tight hover:text-text-main/70 tabular-nums">
            {dateLabel}
          </div>
          <div className="font-mono text-[11px] text-text-main/30 mt-0.5 hover:text-text-main/50 tabular-nums">
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
                <label className="text-[10px] font-mono text-text-main/40 uppercase tracking-wide">
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
                <label className="text-[10px] font-mono text-text-main/40 uppercase tracking-wide">
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
                  className="flex-1 text-[11px] font-medium px-2 py-1.5 rounded-lg bg-brand-soft/15 text-brand-soft hover:bg-brand-soft/25 transition-colors"
                >
                  {t('common_save')}
                </button>
                <button
                  onClick={() => setEditingDateTime(false)}
                  className="flex-1 text-[11px] font-medium px-2 py-1.5 rounded-lg border border-border-subtle text-text-main/40 hover:text-text-main/60 transition-colors"
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
            title={t('archive_edit_title_hint')}
          >
            {highlightText(session.title || t('session_untitled'), searchQuery ?? '')}
          </div>
        )}
        {session.content && (
          <p className="text-sm text-text-main/55 leading-relaxed line-clamp-1 sm:line-clamp-2 mb-2 cursor-pointer" onClick={onOpen}>
            {highlightText(session.content.slice(0, 200), searchQuery ?? '')}
          </p>
        )}
        <InlineTags
          tags={session.tags || []}
          onChange={(newTags) => onTagsChange?.(session, newTags)}
          allTags={allTags}
        />
      </div>

      <div className="flex items-center gap-1 shrink-0 pt-1" onClick={e => e.stopPropagation()}>
        <div className="relative">
          <button
            onClick={e => { e.stopPropagation(); e.preventDefault(); setLabelPopupOpen(!labelPopupOpen); }}
            className={cn("w-7 h-7 flex items-center justify-center rounded-lg transition-all", label ? "" : "hover:bg-text-main/5")}
            title={label?.name ?? t('archive_assign_label')}
          >
            <div className={cn("w-4 h-4 rounded-full border-2 transition-all", label ? "border-transparent" : "border-border-subtle group-hover:border-text-main/20")}
              style={{ background: label?.color ?? 'transparent' }}
            />
          </button>
          {labelPopupOpen && labels && labels.length > 0 && (
            <div
              ref={labelPopupRef}
              className="absolute right-0 top-full z-50 mt-1 border border-border-subtle rounded-xl p-1.5 shadow-xl min-w-[150px] backdrop-blur-xl"
              style={{ background: 'color-mix(in srgb, var(--bg-base) 92%, var(--brand-primary) 8%)' }}
              onClick={e => e.stopPropagation()}
            >
              {labels.map(l => (
                <button
                  key={l.id}
                  onClick={e => { e.stopPropagation(); onLabelChange?.(session, session.labelId === l.id ? undefined : l.id); setLabelPopupOpen(false); }}
                  className={cn("w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left transition-all", session.labelId === l.id ? "bg-text-main/10 text-text-main" : "text-text-main/60 hover:bg-text-main/5")}
                >
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: l.color }} />
                  {l.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={e => { e.stopPropagation(); setTitleDraft(session.title || ''); setEditingTitle(true); }}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-text-main/20 hover:text-text-main/60 hover:bg-text-main/5 transition-all opacity-0 group-hover:opacity-100"
          title={t('archive_edit_title_hint')}>
          <Pencil size={13} />
        </button>
        <button onClick={e => { e.stopPropagation(); onOpen(); }}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-text-main/20 hover:text-text-main/60 hover:bg-text-main/5 transition-all opacity-0 group-hover:opacity-100"
          title={t('archive_preview')}>
          <ExternalLink size={13} />
        </button>
        <StorageIcons
          doc={{
            localId: session._isLocal ? session.id : undefined,
            cloudId: session._linkedCloudId,
            hasLocal: !!session._isLocal,
            hasCloud: !!session._hasCloudCopy,
          }}
          userId={userId}
          onStorageChange={() => onStorageChange?.()}
        />
        <button onClick={e => { e.stopPropagation(); onDelete?.(session); }}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-text-main/15 hover:text-red-400 hover:bg-red-400/5 transition-all opacity-0 group-hover:opacity-100"
          title={t('archive_delete')}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

const MemoizedNoteRow = React.memo(NoteRow);
export { MemoizedNoteRow as NoteRow };
