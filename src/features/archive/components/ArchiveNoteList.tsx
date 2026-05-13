import { motion } from 'motion/react';
import { format } from 'date-fns';
import { BookOpen } from 'lucide-react';
import { GridNoteCard } from './GridNoteCard';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { EmptyState } from '../../../shared/components/EmptyState';
import { NoteRow } from './NoteRow';
import { ArchiveSession } from '../types';
import { Label } from '../../../types';
import { Locale } from 'date-fns';

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
  onOpen: (s: ArchiveSession) => void;
  onDelete: (s: ArchiveSession) => void;
  onTagsChange: (s: ArchiveSession, tags: string[]) => void;
  onTitleChange: (s: ArchiveSession, title: string) => void;
  onDateChange: (s: ArchiveSession, date: Date) => void;
  onLabelChange: (s: ArchiveSession, labelId: string | undefined) => void;
  onStorageChange: () => void;
  t: (key: string) => string;
  language: string;
  entriesLabel: (n: number) => string;
}

export function ArchiveNoteList({
  viewMode, loading, error, filteredSessions,
  groupedSessions, sortedDates, dateLocale,
  labels, userId, searchQuery,
  onOpen, onDelete, onTagsChange, onTitleChange,
  onDateChange, onLabelChange, onStorageChange,
  t, language, entriesLabel,
}: ArchiveNoteListProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-16">
        <motion.div
          animate={{ opacity: [0.7, 1, 0.7] }}
          transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
          style={{ filter: "drop-shadow(0 0 24px color-mix(in srgb, var(--brand-soft) 40%, transparent))" }}
        >
          <JustWritingLogo size={120} variant="dark" showRailway={true} showRoman={true} showCrown={true} />
        </motion.div>
        <p className="text-sm text-text-main/35 tracking-widest uppercase font-sans">
          {t('archive_loading')}
        </p>
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
    return (
      <EmptyState
        icon={BookOpen}
        title={t('archive_empty_title')}
        description={t('archive_empty_subtitle')}
      />
    );
  }

  return (
    <div className="space-y-1">
      {sortedDates.map(dateKey => (
        <div key={dateKey}>
          {viewMode !== 'grid' && (
            <div className="flex items-center gap-4 py-4">
              <h4 className="text-[15px] font-medium text-text-main whitespace-nowrap">
                {format(new Date(dateKey), 'd MMMM yyyy', { locale: dateLocale })}
              </h4>
              <div className="flex-1 h-px bg-border-subtle" />
              <span className="font-mono text-[11px] text-text-main/35 whitespace-nowrap">
                {groupedSessions[dateKey].length} {entriesLabel(groupedSessions[dateKey].length)} · {' '}
                {groupedSessions[dateKey]
                  .reduce((sum, s) => sum + (s.wordCount || 0), 0)
                  .toLocaleString()} {t('home_words_short')}
              </span>
            </div>
          )}
          {viewMode === 'list' ? (
            <div className="flex flex-col">
              {groupedSessions[dateKey].map(session => (
                <NoteRow
                  key={session.id}
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
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-3">
              {groupedSessions[dateKey].map(session => (
                <GridNoteCard
                  key={session.id}
                  session={session}
                  onClick={() => onOpen(session)}
                  searchQuery={searchQuery}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
