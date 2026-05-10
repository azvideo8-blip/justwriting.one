import React from 'react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { Session } from '../../../types';
import { parseFirestoreDate } from '../../../core/utils/utils';
import { getDateLocale } from '../../../core/utils/dateUtils';
import { highlightText } from '../../../shared/utils/highlightText';
import { useLanguage } from '../../../core/i18n';
import { useSessionTags } from '../../writing/hooks/useSessionTags';

interface GridNoteCardProps {
  session: Session;
  onClick: () => void;
  searchQuery?: string;
  onTagsChange?: (id: string, tags: string[]) => void;
}

function getSessionDate(s: Session): Date {
  const ts = s.sessionStartTime ?? null;
  if (ts) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  return parseFirestoreDate(s.createdAt);
}

/* eslint-disable react/prop-types */
export const GridNoteCard: React.FC<GridNoteCardProps> = React.memo(({
  session,
  onClick,
  searchQuery = '',
}) => {
  const { t, language } = useLanguage();
  const { tags } = useSessionTags(session.id, session.tags || []);
  const sessionDate = getSessionDate(session);

  const formattedDate = format(sessionDate, 'd MMM yy • HH:mm', {
    locale: getDateLocale(language),
  }).toUpperCase();

  return (
    <motion.div
      onClick={onClick}
      className="cursor-pointer rounded-2xl p-5 bg-surface-card border border-border-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-main/30
                 hover:border-text-main/20 hover:bg-text-main/[0.07] transition-colors
                 flex flex-col"
    >
      <div className="text-[11px] font-medium tracking-wider text-text-main/40 font-mono mb-3">
        {formattedDate}
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

      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {tags.map(tag => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-text-main/[0.06] text-text-main/50"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-2 text-[12px] font-mono text-text-main/35 pt-3 mt-2 border-t border-border-subtle">
        <span>{session.wordCount.toLocaleString()} {t('home_words_short')}</span>
        <span className="text-text-main/15">·</span>
        <span>{Math.floor(session.duration / 60)} {t('goal_time_short')}</span>
      </div>
    </motion.div>
  );
});

GridNoteCard.displayName = 'GridNoteCard';
