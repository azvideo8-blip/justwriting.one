import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X, ArrowRight, Download, ChevronDown, Sparkles, ChevronUp, Loader2, Paperclip, Copy, Lock, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Label } from '../../../types';
import { ArchiveSession } from '../types';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { cn } from '../../../core/utils/utils';
import { toDate, getDateLocale } from '../../../core/utils/dateUtils';
import { exportAsTxt, exportAsMd, exportAsPdf, exportAsDocx, ExportStrings, isExportable } from '../../../core/services/ArchiveExportService';
import { CopyNoteModal } from './CopyNoteModal';
import { InlineTags } from './InlineTags';
import { LABEL_PRESET_COLORS } from '../../../core/constants/labelColors';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';

import type { AIDocumentSummary } from '../../../core/storage/localDb';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { readingTimeMinutes } from '../../../shared/utils/readingTime';
import type { RelatedNote } from '../../../shared/types/common';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { getLocalDb } from '../../../core/storage/localDb';
import { getCurrentUser } from '../../../core/auth';
import { reportError } from '../../../shared/errors/reportError';
import { aiErrorToText } from '../../../shared/ai/aiErrorUtils';
import { isBlankTitle } from '../../../shared/utils/titleUtils';

const relatedNotesCache = new Map<string, RelatedNote[]>();

export function DocumentPreview({
  session: propSession, onClose, onContinue, onTagsChange, onLabelChange, onAddLabel, labels, allTags, onAttach,
  onAnalyzeNote, fetchSummary, fetchRelatedNotes, context,
}: {
  session: ArchiveSession | null;
  onClose: () => void;
  onContinue: (session: ArchiveSession) => void;
  onTagsChange?: ((session: ArchiveSession, tags: string[]) => void) | undefined;
  onLabelChange?: ((session: ArchiveSession, labelId: string | undefined) => void) | undefined;
  onAddLabel?: ((label: { name: string; color: string; id?: string }) => void) | undefined;
  labels?: Label[] | undefined;
  allTags?: string[] | undefined;
  onAttach?: ((documentId: string) => void) | undefined;
  onAnalyzeNote?: ((sessionId: string) => Promise<{ ok: boolean; error?: string }>) | undefined;
  fetchSummary?: ((sessionId: string) => Promise<AIDocumentSummary | null>) | undefined;
  fetchRelatedNotes?: ((sessionId: string) => Promise<RelatedNote[]>) | undefined;
  context?: string | undefined;
}) {
  const [session, setSession] = useState<ArchiveSession | null>(propSession);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop as initial state with local edits (tags/labels) at :500+, synchronized when propSession reference changes
    setSession(propSession);
  }, [propSession]);

  const { t, tp, language } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const sittingCount = session?.sittings && session.sittings.length > 0 ? session.sittings.length : null;
  const [fetchedVersions, setFetchedVersions] = useState<{ id: string; count: number | null } | null>(null);
  // Сравнение через `?.` совпадало бы и когда обеих величин нет: `null?.id` и
  // `null?.id` — это undefined === undefined, то есть истина, и следом шло
  // чтение `.count` у null. Проверяем наличие обеих сторон явно.
  const versionCount = sittingCount ?? (
    fetchedVersions !== null && session !== null && fetchedVersions.id === session.id
      ? fetchedVersions.count
      : null
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const [labelPopupOpen, setLabelPopupOpen] = useState(false);
  const labelPopupRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Math.min(600, Math.max(380, window.innerWidth * 0.6)));
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const currentWidthRef = useRef(width);
  const panelRef = useRef<HTMLDivElement>(null);

  const [creatingLabel, setCreatingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState<string>(LABEL_PRESET_COLORS[0]!);

  const [summary, setSummary] = useState<AIDocumentSummary | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [justFinished, setJustFinished] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset analysis state when switching previewed session
    setAnalyzing(false);
    setJustFinished(false);
    setAnalyzeError(null);
    if (!session?.id || !fetchSummary) {
      void Promise.resolve().then(() => {
        if (active) setSummary(null);
      });
      return;
    }
    const id = session.id;
    const load = () => void fetchSummary(id).then(s => {
      if (active) setSummary(s ?? null);
    });
    load();
    // Разбор, сделанный на другом устройстве, приезжает фоновым проходом.
    window.addEventListener('ai-data-pulled', load);
    return () => {
      active = false;
      window.removeEventListener('ai-data-pulled', load);
    };
  }, [session?.id, fetchSummary]);

  useEffect(() => {
    let active = true;
    if (!session?.id || (session.sittings && session.sittings.length > 0)) {
      return;
    }
    LocalVersionService.getVersions(session.id)
      .then(v => {
        if (active) setFetchedVersions({ id: session.id, count: v.length });
      })
      .catch(() => {
        if (active) setFetchedVersions({ id: session.id, count: null });
      });
    return () => {
      active = false;
    };
  }, [session?.id, session?.sittings]);

  const handleAnalyzeNote = async () => {
    if (!session?.id || analyzing || session.excludedFromAI || !onAnalyzeNote) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await onAnalyzeNote(session.id);
      if (res.ok) {
        setJustFinished(true);
        showToast(t('ai_note_analyzed'), 'success');
        if (fetchSummary) {
          const updated = await fetchSummary(session.id);
          if (updated) setSummary(updated);
        }
      } else {
        const errMsg = aiErrorToText(res.error, { t, isLoggedIn: !!getCurrentUser() });
        setAnalyzeError(errMsg);
        const isConsentRequired = res.error === 'AI_CONSENT_REQUIRED';
        showToast(
          errMsg,
          'error',
          isConsentRequired
            ? { label: t('settings_open'), onClick: () => { void navigate('/settings#security'); } }
            : undefined,
        );
      }
    } catch (e) {
      reportError(e, { action: 'documentPreview_analyze', documentId: session.id }, 'warning');
      setAnalyzeError(t('ai_error_server'));
      showToast(t('ai_error_server'), 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const [relatedNotes, setRelatedNotes] = useState<RelatedNote[]>([]);

  useEffect(() => {
    let active = true;
    if (!session?.id || !fetchRelatedNotes) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear related notes when no session is selected
      setRelatedNotes([]);
      return;
    }

    const cached = relatedNotesCache.get(session.id);
    if (cached) {
      setRelatedNotes(cached);
      return;
    }

    void (async () => {
      try {
        const related = await fetchRelatedNotes(session.id!);
        if (active) {
          relatedNotesCache.set(session.id!, related);
          setRelatedNotes(related);
        }
      } catch (e) {
        console.error('[DocumentPreview] failed to compute related notes:', e);
      }
    })();

    return () => {
      active = false;
    };
  }, [session?.id, fetchRelatedNotes]);

  const handleSelectRelatedNote = useCallback(async (id: string) => {
    try {
      const db = await getLocalDb();
      const doc = await db.get('documents', id);
      if (!doc) return;
      const content = await LocalVersionService.getLatestContent(id);
      const newSession: ArchiveSession = {
        id: doc.id,
        userId: doc.guestId,
        title: doc.title || 'Без названия',
        content: content || '',
        duration: doc.totalDuration || 0,
        wordCount: doc.totalWords || 0,
        charCount: content ? content.length : 0,
        wpm: doc.totalWords ? Math.round(doc.totalWords / (doc.totalDuration / 60 || 1)) : 0,
        tags: doc.tags ?? [],
        labelId: doc.labelId,
        mood: doc.mood,
        createdAt: doc.firstSessionAt || doc.lastSessionAt || 0,
        sessionStartTime: doc.firstSessionAt,
        _isLocal: true,
      };
      setSession(newSession);
    } catch (e) {
      console.error('[DocumentPreview] failed to load related note:', e);
    }
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isMobile) return;
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    currentWidthRef.current = width;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    if (isMobile) return;
    const saved = localStorage.getItem('preview_width');
    if (saved) setTimeout(() => setWidth(Math.max(380, Math.min(window.innerWidth * 0.6, Number(saved)))), 0);
  }, [isMobile]);

  useEffect(() => {
    if (isMobile) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX.current - e.clientX;
      const newWidth = Math.max(380, Math.min(window.innerWidth * 0.6, startWidth.current + delta));
      currentWidthRef.current = newWidth;
      if (panelRef.current) panelRef.current.style.width = `${newWidth}px`;
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const finalWidth = currentWidthRef.current;
      setWidth(finalWidth);
      localStorage.setItem('preview_width', String(Math.round(finalWidth)));
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isMobile]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!labelPopupOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (labelPopupRef.current && !labelPopupRef.current.contains(e.target as Node)) {
        setLabelPopupOpen(false);
        setCreatingLabel(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [labelPopupOpen]);

  // Touch gesture swipe-to-close handlers
  const touchStartX = useRef(0);
  const touchCurrentX = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile) return;
    touchStartX.current = e.touches[0]!.clientX;
    touchCurrentX.current = e.touches[0]!.clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isMobile) return;
    touchCurrentX.current = e.touches[0]!.clientX;
    const deltaX = touchCurrentX.current - touchStartX.current;
    if (deltaX > 0 && panelRef.current) {
      panelRef.current.style.transform = `translateX(${deltaX}px)`;
    }
  };

  const handleTouchEnd = () => {
    if (!isMobile) return;
    const deltaX = touchCurrentX.current - touchStartX.current;
    if (deltaX > 120) {
      onClose();
    } else if (panelRef.current) {
      panelRef.current.style.transform = '';
    }
  };

  if (!session) return null;

  const currentLabel = labels?.find(l => l.id === session.labelId);

  const dateLocale = getDateLocale(language);
  const date = toDate(session.createdAt) ?? new Date();

  const exportStrings: ExportStrings = {
    date: t('export_header_date'),
    words: t('export_header_words'),
    time: t('export_header_time'),
    tags: t('export_header_tags'),
    untitled: t('export_untitled'),
    untitledFilename: t('export_filename_default'),
  };
  // Refuse to export a note whose text could not be read (vault locked, decryption
  // or storage failure) — otherwise the user silently downloads an empty file.
  const exportUnavailableMessage = session._contentNotLoaded
    ? (language === 'ru' ? 'Текст заметки ещё не загружен из облака' : 'Note text is not loaded from cloud yet')
    : session._locked
    ? (language === 'ru' ? 'Заметка заперта — откройте сейф перед экспортом' : 'Note is locked — unlock vault before exporting')
    : language === 'ru'
    ? 'Заметка зашифрована или недоступна — экспортировать нечего.'
    : 'This note is locked or unreadable — there is nothing to export.';
  // PDF and DOCX exporters are async; typing this as `() => void` made passing
  // them a no-misused-promises error.
  const runExport = (fn: () => void | Promise<void>) => {
    if (!isExportable(session)) {
      showToast(exportUnavailableMessage, 'error');
      return;
    }
    void fn();
  };

  const exportFormats = [
    { label: t('export_txt'), action: () => runExport(() => exportAsTxt(session, exportStrings)) },
    { label: t('export_md'), action: () => runExport(() => exportAsMd(session, exportStrings)) },
    { label: t('export_pdf'), action: () => runExport(() => exportAsPdf(session, exportStrings)) },
    { label: t('export_docx'), action: () => runExport(() => exportAsDocx(session, exportStrings)) },
  ];

  const handleCreateLabel = () => {
    const trimmed = newLabelName.trim();
    if (trimmed) {
      onAddLabel?.({ name: trimmed, color: newLabelColor });
      setNewLabelName('');
      setNewLabelColor(LABEL_PRESET_COLORS[0]!);
    }
    setCreatingLabel(false);
  };

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, transform: isMobile ? "translateY(100%)" : "translateX(20px)" }}
      animate={{ opacity: 1, transform: "translateX(0px) translateY(0px)" }}
      exit={{ opacity: 0, transform: isMobile ? "translateY(100%)" : "translateX(20px)" }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      className="glass-panel custom-scrollbar fixed z-50 flex flex-col"
      style={isMobile ? {
        left: 0,
        right: 0,
        bottom: 0,
        top: 'auto',
        height: '92dvh',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
      } : {
        top: 0,
        right: 0,
        bottom: 0,
        width: width,
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {isMobile && (
        <div className="w-9 h-1 rounded-sm bg-white/15 mt-2.5 mx-auto shrink-0" />
      )}
      {/* Drag handle (Disabled on mobile) */}
      {!isMobile && (
        <div
          onMouseDown={handleMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 group"
        >
          <div className="absolute inset-y-0 left-0 w-[2px] bg-transparent group-hover:bg-text-main/20 transition-colors" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between p-6 pb-4 border-b border-border-subtle pt-8 md:pt-6">
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center font-mono text-[10px] uppercase tracking-widest text-text-main/60 mb-2">
            <Button
              onClick={onClose}
              className="p-0 text-text-main/60 hover:text-text-main transition-colors font-mono text-[10px] uppercase tracking-widest flex items-center gap-1"
            >
              ‹ {t('preview_breadcrumb_root')}
            </Button>
            {context && (
              <>
                <span className="mx-1.5 opacity-60">/</span>
                <span className="truncate">{context}</span>
              </>
            )}
          </div>
          <h2 className="text-xl font-medium text-text-main leading-snug mb-1 flex items-center gap-2">
            {session._locked ? (
              <>
                <Lock size={18} className="shrink-0 text-accent-warning/80" aria-label={t('archive_note_locked')} />
                <span className="italic text-text-main/70">{t('archive_note_locked')}</span>
              </>
            ) : session._decryptionError ? (
              <>
                <AlertCircle size={18} className="shrink-0 text-accent-danger/80" aria-label={t('archive_decryption_error')} />
                <span className="italic text-accent-danger/80">{t('archive_decryption_error')}</span>
              </>
            ) : (
              (!isBlankTitle(session.title) ? session.title : undefined) || t('session_untitled')
            )}
          </h2>
          <div className="font-mono text-label-sm text-text-main/60 uppercase tracking-wider">
            {format(date, 'd MMMM yyyy', { locale: dateLocale })}
            {' · '}
            {session.wordCount?.toLocaleString()} {t('home_words_short')}
            {' · '}
            {t('reading_time', { n: readingTimeMinutes(session.wordCount || 0) })}
            {' · '}
            {Math.round((session.duration || 0) / 60)} {t('goal_time_min')}
            {versionCount !== null && versionCount > 1 && (
              <>
                {' · '}
                <span>{tp('archive_version_count', versionCount)}</span>
              </>
            )}
          </div>
          {(labels || onAddLabel) && (
            <div className="relative mt-2">
              <Button
                onClick={() => setLabelPopupOpen(v => !v)}
                className="flex items-center gap-1.5 text-label-sm font-mono"
                title={currentLabel?.name ?? t('archive_assign_label')}
              >
                <div
                  className="w-3 h-3 rounded-full border-2 shrink-0 transition-colors"
                  style={{
                    background: currentLabel?.color ?? 'transparent',
                    borderColor: currentLabel?.color ?? 'rgba(255,255,255,0.2)',
                  }}
                />
                <span className="text-text-main/60 hover:text-text-main/60 transition-colors">
                  {currentLabel?.name ?? t('archive_assign_label')}
                </span>
              </Button>

              {labelPopupOpen && (
                <div
                  ref={labelPopupRef}
                  className="absolute left-0 top-full z-50 mt-1 border border-border-subtle rounded-xl p-1.5 shadow-xl min-w-[160px] backdrop-blur-xl bg-[color-mix(in_srgb,var(--bg-base)_92%,var(--brand-primary)_8%)]"
                  onClick={e => e.stopPropagation()}
                >
              {currentLabel && (
                <Button
                  onClick={() => { onLabelChange?.(session!, undefined); setLabelPopupOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left justify-start whitespace-nowrap text-text-main/60 hover:bg-text-main/5 transition-colors"
                >
                  <div className="w-3 h-3 rounded-full border border-dashed border-text-main/20 shrink-0" />
                  {t('archive_no_label')}
                </Button>
              )}
              {labels?.map(l => (
                <Button
                  key={l.id}
                  onClick={() => {
                    onLabelChange?.(session!, session!.labelId === l.id ? undefined : l.id);
                    setLabelPopupOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left justify-start whitespace-nowrap transition-colors",
                    session?.labelId === l.id
                      ? "bg-text-main/10 text-text-main"
                      : "text-text-main/60 hover:bg-text-main/5"
                  )}
                >
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: l.color }} />
                  {l.name}
                </Button>
              ))}
              {onAddLabel && !creatingLabel && (
                <Button
                  onClick={() => setCreatingLabel(true)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left justify-start whitespace-nowrap text-text-main/60 hover:text-text-main/60 hover:bg-text-main/5 transition-colors border-t border-border-subtle mt-1 pt-2.5"
                >
                  + {t('archive_add_label')}
                </Button>
              )}
              {onAddLabel && creatingLabel && (
                <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-border-subtle mt-1 pt-2">
                  <input
                    value={newLabelName}
                    onChange={e => setNewLabelName(e.target.value)}
                    autoFocus
                    placeholder={t('archive_label_name_placeholder')}
                    className="w-24 bg-transparent text-label-sm text-text-main outline-none placeholder:text-text-main/40"
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateLabel();
                      if (e.key === 'Escape') setCreatingLabel(false);
                    }}
                  />
                  <div className="flex gap-0.5">
                    {LABEL_PRESET_COLORS.slice(0, 6).map(c => (
                      <Button
                        key={c}
                        style={{ background: c }}
                        className={cn("w-3 h-3 rounded-full transition-colors p-0 min-w-0", newLabelColor === c && "ring-1 ring-offset-1 ring-offset-surface-card ring-white/40")}
                        onClick={() => setNewLabelColor(c)}
                        aria-label={`Select color ${c}`}
                      />
                    ))}
                  </div>
                  <Button
                    onClick={handleCreateLabel}
                    disabled={!newLabelName.trim()}
                    className="text-label font-medium text-text-main/60 hover:text-text-main disabled:opacity-30"
                  >
                    {t('common_save')}
                  </Button>
                  <Button onClick={() => setCreatingLabel(false)} className="text-label text-text-main/60 hover:text-text-main/60">✕</Button>
                </div>
              )}
                </div>
              )}
            </div>
          )}
        </div>
        <IconButton
          onClick={onClose}
          className="w-10 h-10 md:w-8 md:h-8 rounded-xl flex items-center justify-center text-text-main/60 hover:text-text-main hover:bg-text-main/5 transition-colors shrink-0 cursor-pointer"
          label={t('close')}
          icon={<X size={18} className="md:w-4 md:h-4" />}
        />
      </div>

      {/* Tags */}
      <div className="px-6 py-3 border-b border-border-subtle">
        <div className="text-label font-mono text-text-main/60 uppercase tracking-widest mb-2">
          {t('finish_tags')}
        </div>
        <InlineTags
          tags={session.tags || []}
          onChange={(newTags) => onTagsChange?.(session, newTags)}
          allTags={allTags}
        />
      </div>

      {/* AI Analysis */}
      <div className="px-6 py-3 border-b border-border-subtle">
        {summary ? (
          <div className="rounded-xl bg-brand-soft/5 border border-brand-soft/15 p-3">
            <Button
              onClick={() => setSummaryExpanded(v => !v)}
              className="w-full flex items-center justify-between text-xs font-medium text-brand-soft"
            >
              <span className="flex items-center gap-1.5 font-sans text-xs tracking-wide text-brand-soft/80 font-semibold uppercase">
                <Sparkles size={12} className="text-brand-soft" />
                {t('archive_preview_ai_title')}
              </span>
              {summaryExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </Button>
            {summaryExpanded && (
              <div className="mt-2 space-y-1.5 text-xs text-text-main/70">
                {summary.summary && (
                  <div className="italic text-text-main/80">{summary.summary}</div>
                )}

                {summary.themes !== undefined && summary.themes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 mb-2">
                    {summary.themes.map((theme, i) => (
                      <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-brand-soft/10 text-brand-soft border border-brand-soft/10 uppercase tracking-wider">
                        #{theme}
                      </span>
                    ))}
                  </div>
                )}

                <div><span className="text-text-main/60">{t('archive_preview_tone')}</span> {summary.tone}</div>
                {summary.insights.length > 0 && (
                  <div>
                    <span className="text-text-main/60">{t('archive_preview_insights')}</span>
                    <ul className="mt-0.5 ml-3 list-disc space-y-0.5">
                      {summary.insights.map((ins, i) => <li key={i}>{ins}</li>)}
                    </ul>
                  </div>
                )}
                {summary.extractedFacts.length > 0 && (
                  <div>
                    <span className="text-text-main/60">{t('archive_preview_facts')}</span>
                    <ul className="mt-0.5 ml-3 list-disc space-y-0.5">
                      {summary.extractedFacts.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : session?.excludedFromAI ? (
          <div className="flex items-center gap-2 text-xs text-text-main/50 italic px-3 py-2 bg-surface-base/5 border border-border-subtle/10 rounded-xl">
            <span>{t('archive_preview_ai_excluded')}</span>
          </div>
        ) : analyzing ? (
          <div className="flex items-center gap-2 text-xs text-text-main/50 italic px-3 py-2 bg-surface-base/5 border border-border-subtle/10 rounded-xl">
            <Loader2 size={12} className="animate-spin text-brand-soft" />
            <span>{t('archive_preview_analyzing')}</span>
          </div>
        ) : justFinished ? (
          <div className="flex items-center gap-2 text-xs text-brand-soft px-3 py-2 bg-brand-soft/5 border border-brand-soft/20 rounded-xl">
            <span>{t('archive_preview_refresh_hint')}</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Button
              onClick={() => void handleAnalyzeNote()}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-brand-soft/10 text-brand-soft border border-brand-soft/20 hover:bg-brand-soft/20 transition-colors"
            >
              <Sparkles size={12} className="text-brand-soft" />
              <span>{t('archive_preview_analyze_btn')}</span>
            </Button>
            {analyzeError && (
              <p className="text-xs text-accent-danger px-1">{analyzeError}</p>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 flex flex-col justify-between">
        {session._locked ? (
          <div className="flex flex-col items-center justify-center text-center p-8 border border-accent-warning/20 bg-accent-warning/5 rounded-2xl my-auto">
            <Lock size={32} className="text-accent-warning/80 mb-3" />
            <p className="text-sm text-text-main/80 font-medium mb-1">{t('archive_note_locked')}</p>
            <p className="text-xs text-text-main/60 max-w-xs mb-4">{t('archive_locked_preview_desc')}</p>
            <Button
              onClick={() => {
                onClose();
                window.dispatchEvent(new CustomEvent('open-vault-unlock'));
              }}
              className="px-4 py-2 bg-brand-soft/20 text-brand-soft hover:bg-brand-soft/30 rounded-xl text-xs font-medium transition-colors"
            >
              {t('archive_unlock')}
            </Button>
          </div>
        ) : session._decryptionError ? (
          <div className="flex flex-col items-center justify-center text-center p-8 border border-accent-danger/20 bg-accent-danger/5 rounded-2xl my-auto">
            <AlertCircle size={32} className="text-accent-danger/80 mb-3" />
            <p className="text-sm text-text-main/80 font-medium mb-1">{t('archive_decryption_error')}</p>
          </div>
        ) : session._contentNotLoaded ? (
          <div className="flex flex-col items-center justify-center text-center p-8 my-auto text-text-main/60">
            <Loader2 size={24} className="animate-spin mb-2" />
            <p className="text-xs">{t('common_loading')}</p>
          </div>
        ) : (
          <p className="text-[15px] text-text-main/80 leading-[1.8] whitespace-pre-wrap text-pretty">
            {session.content || (
              <span className="text-text-main/60 italic">{t('archive_no_content')}</span>
            )}
          </p>
        )}

        {relatedNotes.length > 0 && (
          <div className="mt-8 pt-5 border-t border-border-subtle/40">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-main/55 mb-3 flex items-center gap-1.5">
              <span>Связанные записи</span>
            </h4>
            <div className="space-y-2">
              {relatedNotes.map((note) => (
                <button
                  key={note.documentId}
                  onClick={() => void handleSelectRelatedNote(note.documentId)}
                  className="w-full text-left p-3 rounded-xl border border-border-subtle/40 hover:border-brand-soft/30 bg-surface-card hover:bg-brand-soft/[0.02] transition-all cursor-pointer flex justify-between items-center gap-4 group"
                >
                  <span className="text-sm text-text-main/80 group-hover:text-brand-soft font-medium truncate">
                    {note.title}
                  </span>
                  <span className="text-[11px] font-mono text-text-main/40 whitespace-nowrap bg-surface-elevated px-1.5 py-0.5 rounded border border-border-subtle/50">
                    [#{note.documentId.slice(0, 4)} · {note.date}]
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
        <div className="p-5 border-t border-border-subtle flex gap-2 pb-[calc(env(safe-area-inset-bottom,0px)+var(--bottom-nav-height,72px)+8px)]">
        <Button
          onClick={() => {
            if (session._locked) {
              window.dispatchEvent(new CustomEvent('open-vault-unlock'));
              return;
            }
            if (session._decryptionError) {
              showToast(t('archive_decryption_error'), 'error');
              return;
            }
            onContinue(session);
          }}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-text-main text-surface-base text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
        >
          <ArrowRight size={14} />
          {t('archive_continue_writing')}
        </Button>

        {session !== null && onAttach && (
          <Button
            onClick={() => onAttach(session.id)}
            className="flex items-center justify-center px-3 h-11 rounded-xl bg-surface-card border border-border-subtle text-text-main/60 hover:text-text-main hover:bg-surface-elevated transition-colors text-sm cursor-pointer"
            title="Прикрепить к ИИ"
          >
            <Paperclip size={14} />
          </Button>
        )}

        {session !== null && (
          <Button
            onClick={() => {
              if (session._locked) {
                showToast(t('archive_note_locked'), 'error');
                return;
              }
              if (session._decryptionError) {
                showToast(t('archive_decryption_error'), 'error');
                return;
              }
              if (session._contentNotLoaded) {
                showToast(t('archive_no_content'), 'error');
                return;
              }
              setCopyModalOpen(true);
            }}
            className="flex items-center justify-center px-3 h-11 rounded-xl bg-surface-card border border-border-subtle text-text-main/60 hover:text-text-main hover:bg-surface-elevated transition-colors text-sm cursor-pointer"
            title={t('archive_copy_modal_title')}
          >
            <Copy size={14} />
          </Button>
        )}

        <div className="relative" ref={exportRef}>
          <Button
            onClick={() => setExportOpen(!exportOpen)}
            className="flex items-center gap-1.5 px-3.5 h-11 rounded-xl bg-surface-card border border-border-subtle text-text-main/60 hover:text-text-main hover:bg-surface-elevated transition-colors text-sm cursor-pointer"
            title={t('archive_export')}
          >
            <Download size={14} />
            <ChevronDown size={12} className={cn("transition-transform", exportOpen && "rotate-180")} />
          </Button>

          <AnimatePresence>
            {exportOpen && (
              <motion.div
                initial={{ opacity: 0, transform: "translateY(-4px) scale(0.97)" }}
                animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
                exit={{ opacity: 0, transform: "translateY(-4px) scale(0.97)" }}
                className={cn("absolute bottom-full mb-2 right-0 border border-border-subtle rounded-xl shadow-xl overflow-hidden w-48 z-50", "bg-surface-popup")}
              >
                {exportFormats.map(fmt => (
                  <Button
                    key={fmt.label}
                    onClick={() => {
                      setExportOpen(false);
                      void fmt.action();
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors cursor-pointer"
                  >
                    {fmt.label}
                  </Button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {copyModalOpen && session !== null && (
        <CopyNoteModal
          open={copyModalOpen}
          onClose={() => setCopyModalOpen(false)}
          session={session}
        />
      )}
    </motion.div>
  );
}
