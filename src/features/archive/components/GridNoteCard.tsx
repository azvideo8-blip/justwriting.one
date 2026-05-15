import { useState, useRef, useEffect, memo } from 'react';
import { motion } from 'motion/react';
import { format, formatDistanceToNow } from 'date-fns';
import { ArchiveSession } from '../types';
import { Label } from '../../../types';
import { getSessionDate, cn } from '../../../core/utils/utils';
import { getDateLocale } from '../../../core/utils/dateUtils';
import { highlightText } from '../../../shared/utils/highlightText';
import { InlineTags } from './InlineTags';
import { useLanguage } from '../../../core/i18n';
import { useSessionTags } from '../../writing/hooks/useSessionTags';

interface GridNoteCardProps {
  session: ArchiveSession;
  onClick: () => void;
  searchQuery?: string;
  labels?: Label[];
  allTags?: string[];
  onTagsChange?: (session: ArchiveSession, tags: string[]) => void;
  onLabelChange?: (session: ArchiveSession, labelId: string | undefined) => void;
}

export const GridNoteCard = memo<GridNoteCardProps>(({
  session,
  onClick,
  searchQuery = '',
  labels,
  allTags,
  onTagsChange,
  onLabelChange,
}) => {
  const { t, language } = useLanguage();
  const { tags } = useSessionTags(session.id, session.tags || []);
  const sessionDate = getSessionDate(session) ?? new Date();
  const [labelPopupOpen, setLabelPopupOpen] = useState(false);
  const labelPopupRef = useRef<HTMLDivElement>(null);

  const label = labels?.find(l => l.id === session.labelId);

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

  const formattedDate = format(sessionDate, 'd MMM yy • HH:mm', {
    locale: getDateLocale(language),
  }).toUpperCase();

  const relativeDate = formatDistanceToNow(sessionDate, {
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
                 flex flex-col"
      style={label ? {
        borderLeftWidth: 2,
        borderLeftColor: label.color,
        background: `color-mix(in srgb, ${label.color} 5%, var(--color-surface-card))`,
        boxShadow: `inset 3px 0 10px color-mix(in srgb, ${label.color} 12%, transparent)`,
      } : {}}
    >
      <div className="text-[11px] font-medium tracking-wider text-text-main/40 font-mono mb-3">
        {formattedDate}
        <span className="text-text-main/25 ml-1.5">{relativeDate}</span>
      </div>

      {session.title && (
        <h4 className="text-[17px] font-semibold text-text-main mb-2 leading-snug">
          {highlightText(session.title, searchQuery)}
        </h4>
      )}

      <div className="relative">
        <p className="text-[14px] leading-relaxed text-text-main/65 line-clamp-4 whitespace-pre-wrap">
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

      <div className="flex-1" />

      <div className="flex items-center gap-2 text-[12px] font-mono text-text-main/35 pt-3 mt-2 border-t border-border-subtle">
        <span>{session.wordCount.toLocaleString()} {t('home_words_short')}</span>
        <span className="text-text-main/15">·</span>
        <span>{Math.floor(session.duration / 60)} {t('goal_time_short')}</span>
        {labels && onLabelChange && (
          <div className="relative ml-auto" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setLabelPopupOpen(v => !v)}
              className="flex items-center gap-1 font-mono text-[11px] text-text-main/30 hover:text-text-main/60 transition-colors"
            >
              <span
                className="w-2.5 h-2.5 rounded-full border border-text-main/20 shrink-0"
                style={label ? { background: label.color, borderColor: label.color } : {}}
              />
              {label?.name ?? t('archive_assign_label')}
            </button>
            {labelPopupOpen && (
              <div
                ref={labelPopupRef}
                className="absolute right-0 bottom-full mb-1 z-50 border border-border-subtle rounded-xl p-1.5 shadow-xl min-w-[150px] backdrop-blur-xl"
                style={{ background: 'color-mix(in srgb, var(--bg-base) 92%, var(--brand-primary) 8%)' }}
                onClick={e => e.stopPropagation()}
              >
                {session.labelId && (
                  <button
                    onClick={() => { onLabelChange(session, undefined); setLabelPopupOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left text-text-main/40 hover:bg-text-main/5 transition-all"
                  >
                    <div className="w-3 h-3 rounded-full border border-dashed border-text-main/20 shrink-0" />
                    {t('archive_no_label')}
                  </button>
                )}
                {labels.map(l => (
                  <button
                    key={l.id}
                    onClick={() => { onLabelChange(session, session.labelId === l.id ? undefined : l.id); setLabelPopupOpen(false); }}
                    className={cn("w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left transition-all", session.labelId === l.id ? "bg-text-main/10 text-text-main" : "text-text-main/60 hover:bg-text-main/5")}
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
    </motion.div>
  );
});

GridNoteCard.displayName = 'GridNoteCard';
