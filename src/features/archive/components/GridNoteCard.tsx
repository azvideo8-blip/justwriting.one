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
import { Sparkles } from 'lucide-react';

interface GridNoteCardProps {
  session: ArchiveSession;
  onClick: () => void;
  searchQuery?: string | undefined;
  labels?: Label[] | undefined;
  allTags?: string[] | undefined;
  onTagsChange?: ((session: ArchiveSession, tags: string[]) => void) | undefined;
  onLabelChange?: ((session: ArchiveSession, labelId: string | undefined) => void) | undefined;
  aiProcessed?: boolean | undefined;
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
  aiProcessed,
  onAIClick,
}) => {
  const { t, language } = useLanguage();
  const { tags: _tags } = useSessionTags(session.tags || []);
  const sessionDate = getSessionDate(session) ?? new Date();
  const [labelPopupOpen, setLabelPopupOpen] = useState(false);
  const [labelOpenUp, setLabelOpenUp] = useState(false);
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
                 flex flex-col gap-3"
      style={label ? {
        borderLeftWidth: 2,
        borderLeftColor: label.color,
        background: `color-mix(in srgb, ${label.color} 5%, var(--color-surface-card))`,
        boxShadow: `inset 3px 0 10px color-mix(in srgb, ${label.color} 12%, transparent)`,
      } : {}}
    >
      <div className="text-label-sm font-medium tracking-wider text-text-main/40 font-mono">
        {formattedDate}
        <span className="text-text-main/25 ml-1.5">{relativeDate}</span>
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

      <div className="flex items-center gap-2 text-[12px] font-mono text-text-main/40 pt-3 mt-auto border-t border-border-subtle">
        <span>{session.wordCount.toLocaleString()} {t('home_words_short')}</span>
        <span className="text-text-main/25">·</span>
        <span>{Math.floor(session.duration / 60)} {t('goal_time_short')}</span>
        {labels && onLabelChange && (
          <div className="relative ml-auto" onClick={e => e.stopPropagation()}>
            <button
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                setLabelOpenUp(spaceBelow < 220);
                setLabelPopupOpen(v => !v);
              }}
              className="flex items-center gap-1 font-mono text-label-sm text-text-main/30 hover:text-text-main/60 transition-colors"
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
                className={cn(
                  "absolute right-0 z-50 border border-border-subtle rounded-xl p-1.5 shadow-xl min-w-[150px] backdrop-blur-xl",
                  labelOpenUp ? "bottom-full mb-1" : "top-full mt-1",
                  "bg-[color-mix(in_srgb,var(--bg-base)_92%,var(--brand-primary)_8%)]"
                )}
                onClick={e => e.stopPropagation()}
              >
                {session.labelId && (
                  <button
                    onClick={() => { onLabelChange(session, undefined); setLabelPopupOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left text-text-main/40 hover:bg-text-main/5 transition-colors"
                  >
                    <div className="w-3 h-3 rounded-full border border-dashed border-text-main/20 shrink-0" />
                    {t('archive_no_label')}
                  </button>
                )}
                {labels.map(l => (
                  <button
                    key={l.id}
                    onClick={() => { onLabelChange(session, session.labelId === l.id ? undefined : l.id); setLabelPopupOpen(false); }}
                    className={cn("w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left transition-colors", session.labelId === l.id ? "bg-text-main/10 text-text-main" : "text-text-main/60 hover:bg-text-main/5")}
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
