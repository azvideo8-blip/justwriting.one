import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, ArrowRight, Download, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { Label } from '../../../types';
import { ArchiveSession } from '../types';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { toDate, getDateLocale } from '../../../core/utils/dateUtils';
import { exportAsTxt, exportAsMd, exportAsPdf, exportAsDocx, ExportStrings } from '../services/ArchiveExportService';
import { InlineTags } from './InlineTags';

export function DocumentPreview({ session, onClose, onContinue, onTagsChange, onLabelChange, labels }: {
  session: ArchiveSession | null;
  onClose: () => void;
  onContinue: (session: ArchiveSession) => void;
  onTagsChange?: (session: ArchiveSession, tags: string[]) => void;
  onLabelChange?: (session: ArchiveSession, labelId: string | undefined) => void;
  labels?: Label[];
}) {
  const { t, language } = useLanguage();
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const [labelPopupOpen, setLabelPopupOpen] = useState(false);
  const labelPopupRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Math.min(600, window.innerWidth * 0.55));
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const currentWidthRef = useRef(width);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    currentWidthRef.current = width;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const saved = localStorage.getItem('preview_width');
    if (saved) setTimeout(() => setWidth(Math.max(380, Math.min(window.innerWidth * 0.8, Number(saved)))), 0);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX.current - e.clientX;
      const newWidth = Math.max(380, Math.min(window.innerWidth * 0.8, startWidth.current + delta));
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
  }, []);

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
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [labelPopupOpen]);

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

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, x: '100%' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-base)',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: 6,
          cursor: 'ew-resize',
          zIndex: 10,
        }}
        className="group"
      >
        <div className="absolute inset-y-0 left-0 w-[2px] bg-transparent group-hover:bg-text-main/20 transition-colors" />
      </div>

      {/* Header */}
      <div className="flex items-start justify-between p-6 pb-4 border-b border-border-subtle">
        <div className="flex-1 min-w-0 pr-4">
          <h2 className="text-xl font-medium text-text-main leading-snug mb-1">
            {session.title || t('session_untitled')}
          </h2>
          <div className="font-mono text-[11px] text-text-main/30 uppercase tracking-wider">
            {format(date, 'd MMMM yyyy', { locale: dateLocale })}
            {' · '}
            {session.wordCount?.toLocaleString()} {t('home_words_short')}
            {' · '}
            {Math.round((session.duration || 0) / 60)} {t('goal_time_min')}
          </div>
          {labels && labels.length > 0 && (
            <div className="relative mt-2">
              <button
                onClick={() => setLabelPopupOpen(v => !v)}
                className="flex items-center gap-1.5 text-[11px] font-mono"
                title={currentLabel?.name ?? t('archive_assign_label')}
              >
                <div
                  className="w-3 h-3 rounded-full border-2 shrink-0 transition-all"
                  style={{
                    background: currentLabel?.color ?? 'transparent',
                    borderColor: currentLabel?.color ?? 'rgba(255,255,255,0.2)',
                  }}
                />
                <span className="text-text-main/40 hover:text-text-main/60 transition-colors">
                  {currentLabel?.name ?? t('archive_assign_label')}
                </span>
              </button>

              {labelPopupOpen && (
                <div
                  ref={labelPopupRef}
                  className="absolute left-0 top-full z-50 mt-1 border border-border-subtle rounded-xl p-1.5 shadow-xl min-w-[160px] backdrop-blur-xl"
                  style={{ background: 'color-mix(in srgb, var(--bg-base) 92%, var(--brand-primary) 8%)' }}
                  onClick={e => e.stopPropagation()}
                >
                  {currentLabel && (
                    <button
                      onClick={() => { onLabelChange?.(session!, undefined); setLabelPopupOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left text-text-main/40 hover:bg-text-main/5 transition-all"
                    >
                      <div className="w-3 h-3 rounded-full border border-dashed border-text-main/20 shrink-0" />
                      {t('archive_no_label')}
                    </button>
                  )}
                  {labels.map(l => (
                    <button
                      key={l.id}
                      onClick={() => {
                        onLabelChange?.(session!, session!.labelId === l.id ? undefined : l.id);
                        setLabelPopupOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left transition-all",
                        session?.labelId === l.id
                          ? "bg-text-main/10 text-text-main"
                          : "text-text-main/60 hover:bg-text-main/5"
                      )}
                    >
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ background: l.color }} />
                      {l.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-text-main/30 hover:text-text-main hover:bg-text-main/5 transition-all shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tags */}
      <div className="px-6 py-3 border-b border-border-subtle">
        <div className="text-[10px] font-mono text-text-main/30 uppercase tracking-widest mb-2">
          {t('finish_tags')}
        </div>
        <InlineTags
          tags={session.tags || []}
          onChange={(newTags) => onTagsChange?.(session, newTags)}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <p className="text-[15px] text-text-main/75 leading-[1.8] whitespace-pre-wrap">
          {session.content || (
            <span className="text-text-main/25 italic">{t('archive_no_content')}</span>
          )}
        </p>
      </div>

      {/* Actions */}
      <div className="p-5 border-t border-border-subtle flex gap-2">
        <button
          onClick={() => onContinue(session)}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-text-main text-surface-base text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <ArrowRight size={14} />
          {t('archive_continue_writing')}
        </button>

        <div className="relative" ref={exportRef}>
          <button
            onClick={() => setExportOpen(!exportOpen)}
            className="flex items-center gap-1.5 px-3 h-10 rounded-xl bg-surface-card border border-border-subtle text-text-main/60 hover:text-text-main hover:bg-surface-elevated transition-all text-sm"
            title={t('archive_export')}
          >
            <Download size={14} />
            <ChevronDown size={12} className={cn("transition-transform", exportOpen && "rotate-180")} />
          </button>

          <AnimatePresence>
            {exportOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                className="absolute bottom-full mb-2 right-0 border border-border-subtle rounded-xl shadow-xl overflow-hidden w-48 z-50"
                style={{ background: 'var(--bg-elevated)' }}
              >
                {exportFormats.map(fmt => (
                  <button
                    key={fmt.label}
                    onClick={async () => {
                      setExportOpen(false);
                      await fmt.action();
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors"
                  >
                    {fmt.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
