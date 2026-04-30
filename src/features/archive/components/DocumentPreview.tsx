import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, ArrowRight, Download, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { ArchiveSession } from '../pages/ArchivePage';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { exportAsTxt, exportAsMd, exportAsPdf, exportAsDocx } from '../services/ArchiveExportService';
import { InlineTags } from './InlineTags';

function toJsDate(d: Date | { toDate?: () => Date }): Date {
  if (d instanceof Date) return d;
  if (d && typeof d === 'object' && 'toDate' in d) return (d as { toDate: () => Date }).toDate();
  return new Date();
}

export function DocumentPreview({ session, onClose, onContinue, onTagsChange }: {
  session: ArchiveSession | null;
  onClose: () => void;
  onContinue: (session: ArchiveSession) => void;
  onTagsChange?: (session: ArchiveSession, tags: string[]) => void;
}) {
  const { t, language } = useLanguage();
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Math.min(600, window.innerWidth * 0.55));
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
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
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('preview_width', String(Math.round(width)));
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [width]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!session) return null;

  const dateLocale = language === 'ru' ? ru : enUS;
  const date = toJsDate(session.createdAt);

  const exportFormats = [
    { label: 'TXT', action: () => exportAsTxt(session) },
    { label: 'Markdown (.md)', action: () => exportAsMd(session) },
    { label: 'PDF', action: () => exportAsPdf(session) },
    { label: 'DOCX — Word', action: () => exportAsDocx(session) },
  ];

  return (
    <motion.div
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
        background: '#0b0d0c',
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
                style={{ background: '#111413' }}
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
