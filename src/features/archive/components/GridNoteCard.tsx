import { useState, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { format, formatDistanceToNow } from 'date-fns';
import { ArchiveSession } from '../types';
import { Label } from '../../../types';
import { cn } from '../../../core/utils/utils';
import { getDateLocale } from '../../../core/utils/dateUtils';
import { highlightText } from '../../../shared/utils/highlightText';
import { InlineTags } from './InlineTags';
import { useLanguage } from '../../../shared/i18n';
import { useSessionTags } from '../../writing/hooks/useSessionTags';

import { Button } from '../../../shared/components/Button';

interface GridNoteCardProps {
  session: ArchiveSession;
  onClick: () => void;
  searchQuery?: string | undefined;
  labels?: Label[] | undefined;
  allTags?: string[] | undefined;
  onTagsChange?: ((session: ArchiveSession, tags: string[]) => void) | undefined;
  onLabelChange?: ((session: ArchiveSession, labelId: string | undefined) => void) | undefined;
  aiProcessed?: boolean | undefined;
  aiLoading?: boolean | undefined;
  onAIClick?: (() => void) | undefined;
}

export const GridNoteCard = memo<GridNoteCardProps>(({
  session,
  onClick,
  searchQuery = '',
  labels,
  allTags,
  onTagsChange,
  onLabelChange,
  aiProcessed: _aiProcessed,
  aiLoading: _aiLoading,
  onAIClick: _onAIClick,
}) => {
  const { t, language } = useLanguage();
  const { tags: _tags } = useSessionTags(session.tags || []);
  const sessionTime = session.sessionStartTime
    ? new Date(session.sessionStartTime)
    : session.createdAt instanceof Date ? session.createdAt : new Date();
  const [labelPopupOpen, setLabelPopupOpen] = useState(false);
  // fixed-position coords: popup renders in a portal so the archive scroll
  // container (overflow-y-auto) can't clip it
  const [labelPopupPos, setLabelPopupPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const labelPopupRef = useRef<HTMLDivElement>(null);

  const label = labels?.find(l => l.id === session.labelId);

  useEffect(() => {
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

  const formattedDate = format(sessionTime, 'd MMM yy • HH:mm', {
    locale: getDateLocale(language),
  }).toUpperCase();

  const relativeDate = formatDistanceToNow(sessionTime, {
    locale: getDateLocale(language),
    addSuffix: true,
  });

  return (
    <motion.div
      onClick={onClick}
      whileHover={{ y: -3, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 350, damping: 25 }}
      className="cursor-pointer rounded-2xl p-5 bg-surface-card border border-border-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-main/30
                 hover:border-text-main/20 hover:bg-text-main/[0.07] hover:shadow-lg transition-colors
                 flex flex-col gap-3"
      style={label ? {
        borderLeftWidth: 2,
        borderLeftColor: label.color,
        background: `color-mix(in srgb, ${label.color} 5%, var(--color-surface-card))`,
        boxShadow: `inset 3px 0 10px color-mix(in srgb, ${label.color} 12%, transparent)`,
      } : {}}
    >
      <div className="text-label-sm font-medium tracking-wider text-text-main/60 font-mono">
        {formattedDate}
        <span className="text-text-main/60 ml-1.5">{relativeDate}</span>
      </div>

      {session.title && (
        <h4 className="text-[17px] font-semibold text-text-main leading-snug">
          {highlightText(session.title, searchQuery)}
        </h4>
      )}

      <div className="relative">
        <p className="text-[14px] leading-relaxed text-text-main/60 line-clamp-4 whitespace-pre-wrap">
          {highlightText(session.content, searchQuery)}
        </p>
      </div>

      <div onClick={e => e.stopPropagation()}>
        <InlineTags
          tags={session.tags || []}
          allTags={allTags}
          onChange={newTags => onTagsChange?.(session, newTags)}
        />

      </div>

      <div className="flex items-center gap-2 text-[12px] font-mono text-text-main/60 pt-3 mt-auto border-t border-border-subtle">
        <span>{session.wordCount.toLocaleString()} {t('home_words_short')}</span>
        <span className="text-text-main/60">·</span>
        <span>{Math.floor(session.duration / 60)} {t('goal_time_short')}</span>
        {labels && onLabelChange && (
          <div className="relative ml-auto" onClick={e => e.stopPropagation()}>
            <Button
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                const openUp = spaceBelow < 220 && rect.top > spaceBelow;
                setLabelPopupPos({
                  left: Math.max(8, Math.min(rect.left, window.innerWidth - 166)),
                  ...(openUp
                    ? { bottom: window.innerHeight - rect.top + 4, maxHeight: rect.top - 12 }
                    : { top: rect.bottom + 4, maxHeight: spaceBelow - 12 }),
                });
                setLabelPopupOpen(v => !v);
              }}
              className="flex items-center gap-1 font-mono text-label-sm text-text-main/60 hover:text-text-main/60 transition-colors"
            >
              <span
                className="w-2.5 h-2.5 rounded-full border border-text-main/20 shrink-0"
                style={label ? { background: label.color, borderColor: label.color } : {}}
              />
              {label?.name ?? t('archive_assign_label')}
            </Button>
            {labelPopupOpen && labelPopupPos && createPortal(
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
                    onClick={() => { onLabelChange(session, undefined); setLabelPopupOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left justify-start whitespace-nowrap text-text-main/60 hover:bg-text-main/5 transition-colors"
                  >
                    <div className="w-3 h-3 rounded-full border border-dashed border-text-main/20 shrink-0" />
                    {t('archive_no_label')}
                  </Button>
                )}
                {labels.map(l => (
                  <Button
                    key={l.id}
                    onClick={() => { onLabelChange(session, session.labelId === l.id ? undefined : l.id); setLabelPopupOpen(false); }}
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
        )}
      </div>
    </motion.div>
  );
});

GridNoteCard.displayName = 'GridNoteCard';
