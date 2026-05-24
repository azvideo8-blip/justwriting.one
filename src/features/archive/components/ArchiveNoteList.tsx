import { motion, useReducedMotion, LayoutGroup } from 'motion/react';
import { format, Locale } from 'date-fns';
import { BookOpen } from 'lucide-react';
import { GridNoteCard } from './GridNoteCard';
import { EmptyState } from '../../../shared/components/EmptyState';
import { NoteRow } from './NoteRow';
import { ArchiveSession } from '../types';
import { Label } from '../../../types';
import { cn } from '../../../core/utils/utils';

function toRoman(n: number): string {
  if (n < 1 || n > 12) return String(n);
  return ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][n - 1];
}

interface ArchiveNoteListProps {
  viewMode: 'list' | 'grid';
  loading: boolean;
  error: string | null;
  filteredSessions: ArchiveSession[];
  groupedSessions: Record<string, ArchiveSession[]>;
  sortedDates: string[];
  dateLocale: Locale;
  labels: Label[];
  userId: string;
  searchQuery: string;
  isGroupedByDate: boolean;
  onOpen: (s: ArchiveSession) => void;
  onDelete: (s: ArchiveSession) => void;
  onTagsChange: (s: ArchiveSession, tags: string[]) => void;
  onTitleChange: (s: ArchiveSession, title: string) => void;
  onDateChange: (s: ArchiveSession, date: Date) => void;
  onLabelChange: (s: ArchiveSession, labelId: string | undefined) => void;
  onStorageChange: () => void;
  t: (key: string, args?: Record<string, string | number>) => string;
  language: string;
  entriesLabel: (n: number) => string;
  allTags?: string[];
  onClearSearch?: () => void;
}

export function ArchiveNoteList({
  viewMode, loading, error, filteredSessions,
  groupedSessions, sortedDates, dateLocale,
  labels, userId, searchQuery, isGroupedByDate,
  onOpen, onDelete, onTagsChange, onTitleChange,
  onDateChange, onLabelChange, onStorageChange,
  t, language, entriesLabel, allTags, onClearSearch,
}: ArchiveNoteListProps) {
  const reducedMotion = useReducedMotion();

  if (loading) {
    return (
      <div className="space-y-1 mt-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-4 px-4 py-3 rounded-xl",
              !reducedMotion && "animate-pulse"
            )}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex-1 space-y-2">
              <div className="h-3.5 bg-text-main/8 rounded w-1/3" />
              <div className="h-2.5 bg-text-main/5 rounded w-2/3" />
            </div>
            <div className="h-2.5 bg-text-main/5 rounded w-12" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-12 text-center rounded-3xl border bg-red-500/10 border-red-500/30">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (filteredSessions.length === 0) {
    if (searchQuery?.trim()) {
      return (
        <div className="py-16 text-center space-y-3">
          <p className="text-[16px] text-text-main/50 font-medium">
            {t('archive_empty_filtered')}
          </p>
          <p className="text-[13px] text-text-main/40">
            {t('archive_search_no_results', { query: searchQuery })}
          </p>
          <button
            onClick={() => onClearSearch?.()}
            className="text-sm text-brand-soft hover:underline"
          >
            {t('archive_search_clear')}
          </button>
        </div>
      );
    }
    return (
      <EmptyState
        icon={BookOpen}
        title={t('archive_empty_title')}
        description={t('archive_empty_subtitle')}
      />
    );
  }

  if (!isGroupedByDate) {
    return (
      <LayoutGroup>
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-3">
            {filteredSessions.map((session, index) => (
              <motion.div
                key={session.id}
                layoutId={`archive-${session.id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: Math.min(index, 12) * 0.04, ease: 'easeOut' }}
              >
                <GridNoteCard
                  session={session}
                  onClick={() => onOpen(session)}
                  searchQuery={searchQuery}
                  labels={labels}
                  allTags={allTags}
                  onTagsChange={onTagsChange}
                  onLabelChange={onLabelChange}
                />
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col">
            {filteredSessions.map((session, index) => (
              <motion.div
                key={session.id}
                layoutId={`archive-${session.id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: Math.min(index, 12) * 0.03, ease: 'easeOut' }}
              >
                <NoteRow
                  session={session}
                  onOpen={() => onOpen(session)}
                  t={t}
                  language={language}
                  labels={labels}
                  onDelete={(s) => onDelete(s)}
                  onTagsChange={onTagsChange}
                  onStorageChange={onStorageChange}
                  onTitleChange={onTitleChange}
                  onDateChange={onDateChange}
                  onLabelChange={onLabelChange}
                  userId={userId}
                  allTags={allTags}
                  searchQuery={searchQuery}
                />
              </motion.div>
            ))}
          </div>
        )}
      </LayoutGroup>
    );
  }

  return (
    <LayoutGroup>
      <div className="space-y-1">
        {sortedDates.map(dateKey => (
          <div key={dateKey}>
            {viewMode !== 'grid' && (
              <div className="flex items-center gap-3 py-5">
                <span className="font-mono text-label-sm text-text-main/40 uppercase tracking-widest whitespace-nowrap">
                  {format(new Date(dateKey), 'd MMM', { locale: dateLocale })}
                </span>
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, transparent, var(--border-subtle))' }} />
                  <span className="font-mono text-label tracking-[.2em]" style={{ color: 'var(--brand-soft)', opacity: 0.5 }}>
                    {toRoman(groupedSessions[dateKey].length)}
                  </span>
                  <div className="flex-1 h-px" style={{ background: 'linear-gradient(to left, transparent, var(--border-subtle))' }} />
                </div>
                <span className="font-mono text-label-sm text-text-main/30 whitespace-nowrap">
                  {groupedSessions[dateKey]
                    .reduce((sum, s) => sum + (s.wordCount || 0), 0)
                    .toLocaleString()} {t('home_words_short')}
                </span>
              </div>
            )}
            {viewMode === 'list' ? (
              <div className="flex flex-col">
                {groupedSessions[dateKey].map((session, index) => (
                  <motion.div
                    key={session.id}
                    layoutId={`archive-${session.id}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(index, 12) * 0.03, ease: 'easeOut' }}
                  >
                    <NoteRow
                      session={session}
                      onOpen={() => onOpen(session)}
                      t={t}
                      language={language}
                      labels={labels}
                      onDelete={(s) => onDelete(s)}
                      onTagsChange={onTagsChange}
                      onStorageChange={onStorageChange}
                      onTitleChange={onTitleChange}
                      onDateChange={onDateChange}
                      onLabelChange={onLabelChange}
                      userId={userId}
                      allTags={allTags}
                      searchQuery={searchQuery}
                    />
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-3">
                {groupedSessions[dateKey].map((session, index) => (
                  <motion.div
                    key={session.id}
                    layoutId={`archive-${session.id}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(index, 12) * 0.04, ease: 'easeOut' }}
                  >
                    <GridNoteCard
                      session={session}
                      onClick={() => onOpen(session)}
                      searchQuery={searchQuery}
                      labels={labels}
                      allTags={allTags}
                      onTagsChange={onTagsChange}
                      onLabelChange={onLabelChange}
                    />
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </LayoutGroup>
  );
}
