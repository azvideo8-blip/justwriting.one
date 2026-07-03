import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, ArrowRight, Download, ChevronDown, Sparkles, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { Label } from '../../../types';
import { ArchiveSession } from '../types';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { toDate, getDateLocale } from '../../../core/utils/dateUtils';
import { exportAsTxt, exportAsMd, exportAsPdf, exportAsDocx, ExportStrings } from '../services/ArchiveExportService';
import { InlineTags } from './InlineTags';
import { LABEL_PRESET_COLORS } from '../../../core/constants/labelColors';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { AISummaryService } from '../../../core/services/AISummaryService';
import { AIService } from '../../../core/services/AIService';
import type { AIDocumentSummary } from '../../../core/storage/localDb';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { reportError } from '../../../shared/errors/reportError';
import { useToast } from '../../../shared/components/Toast';
import { readingTimeMinutes } from '../../../shared/utils/readingTime';

export function DocumentPreview({ session, onClose, onContinue, onTagsChange, onLabelChange, onAddLabel, labels, allTags }: {
  session: ArchiveSession | null;
  onClose: () => void;
  onContinue: (session: ArchiveSession) => void;
  onTagsChange?: ((session: ArchiveSession, tags: string[]) => void) | undefined;
  onLabelChange?: ((session: ArchiveSession, labelId: string | undefined) => void) | undefined;
  onAddLabel?: ((label: { name: string; color: string }) => void) | undefined;
  labels?: Label[] | undefined;
  allTags?: string[] | undefined;
}) {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const [exportOpen, setExportOpen] = useState(false);
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
  const [summaryLoading, setSummaryLoading] = useState(false);

  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';

  useEffect(() => {
    if (!session?.id) { setSummary(null); return; }
    void AISummaryService.get(session.id).then(s => setSummary(s ?? null));
  }, [session?.id]);

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
  const exportFormats = [
    { label: 'TXT', action: () => exportAsTxt(session, exportStrings) },
    { label: 'Markdown (.md)', action: () => exportAsMd(session, exportStrings) },
    { label: 'PDF', action: () => exportAsPdf(session, exportStrings) },
    { label: 'DOCX — Word', action: () => exportAsDocx(session, exportStrings) },
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
      initial={{ opacity: 0, x: isMobile ? 0 : 20, y: isMobile ? '100%' : 0 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: isMobile ? 0 : 20, y: isMobile ? '100%' : 0 }}
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
          <h2 className="text-xl font-medium text-text-main leading-snug mb-1">
            {session.title || t('session_untitled')}
          </h2>
          <div className="font-mono text-label-sm text-text-main/60 uppercase tracking-wider">
            {format(date, 'd MMMM yyyy', { locale: dateLocale })}
            {' · '}
            {session.wordCount?.toLocaleString()} {t('home_words_short')}
            {' · '}
            {t('reading_time', { n: readingTimeMinutes(session.wordCount || 0) })}
            {' · '}
            {Math.round((session.duration || 0) / 60)} {t('goal_time_min')}
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
          <span className="flex items-center gap-1.5"><Sparkles size={12} /> Анализ ИИ</span>
          {summaryExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </Button>
            {summaryExpanded && (
              <div className="mt-2 space-y-1.5 text-xs text-text-main/70">
                <div><span className="text-text-main/60">Тональность:</span> {summary.tone}</div>
                {summary.insights.length > 0 && (
                  <div>
                    <span className="text-text-main/60">Инсайты:</span>
                    <ul className="mt-0.5 ml-3 list-disc space-y-0.5">
                      {summary.insights.map((ins, i) => <li key={i}>{ins}</li>)}
                    </ul>
                  </div>
                )}
                {summary.extractedFacts.length > 0 && (
                  <div>
                    <span className="text-text-main/60">Факты:</span>
                    <ul className="mt-0.5 ml-3 list-disc space-y-0.5">
                      {summary.extractedFacts.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <Button
            onClick={() => {
              if (!session?.id || !session.content || summaryLoading) return;
              void (async () => {
                setSummaryLoading(true);
                try {
                  const res = await AIService.summarize({ content: session.content, mood: session.mood });
                  if (res.ok) {
                    const s: AIDocumentSummary = {
                      documentId: session.id,
                      tone: res.summary.tone,
                      frequentWords: res.summary.frequentWords,
                      insights: res.summary.insights,
                      themes: res.summary.themes,
                      extractedFacts: res.summary.extractedFacts,
                      processedAt: Date.now(),
                    };
                    await AISummaryService.save(s);
                    setSummary(s);
                    const { getLocalDb } = await import('../../../core/storage/localDb');
                    const db = await getLocalDb();
                    const doc = await db.get('documents', session.id);
                    if (doc) await db.put('documents', { ...doc, aiProcessed: true });

                    const { AIProfileService } = await import('../../ai/services/AIProfileService');
                    AIProfileService.generate().catch(e => reportError(e, { action: 'manual_portrait' }));
                  } else {
                    const errMap: Record<string, string> = {
                      AUTH_REQUIRED: t('ai_error_auth'),
                      DAILY_LIMIT: t('ai_error_rate_limit'),
                      RATE_LIMIT: t('ai_error_rate_limit'),
                      TOO_LONG: t('ai_error_too_long'),
                      SERVER_ERROR: t('ai_error_server'),
                    };
                    showToast(errMap[res.error] ?? t('ai_error_server'), 'error');
                  }
                } catch {
                  showToast(t('ai_error_server'), 'error');
                }
                setSummaryLoading(false);
              })();
            }}
            disabled={summaryLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-soft/5 border border-brand-soft/15 text-xs text-brand-soft hover:bg-brand-soft/10 transition-colors disabled:opacity-40"
          >
            <Sparkles size={12} />
            {summaryLoading ? 'Генерация...' : 'Сгенерировать анализ ИИ'}
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
        <p className="text-[15px] text-text-main/80 leading-[1.8] whitespace-pre-wrap text-pretty" >
          {session.content || (
            <span className="text-text-main/60 italic">{t('archive_no_content')}</span>
          )}
        </p>
      </div>

      {/* Actions */}
        <div className="p-5 border-t border-border-subtle flex gap-2 pb-[calc(env(safe-area-inset-bottom,0px)+var(--bottom-nav-height,72px)+8px)]">
        <Button
          onClick={() => onContinue(session)}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-text-main text-surface-base text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
        >
          <ArrowRight size={14} />
          {t('archive_continue_writing')}
        </Button>

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
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
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
    </motion.div>
  );
}
