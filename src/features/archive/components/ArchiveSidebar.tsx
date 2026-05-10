import React from 'react';
import { ArchiveSession } from '../types';
import { ArchiveStats } from './ArchiveStats';
import { Calendar } from '../../calendar/components/Calendar';
import { useLanguage } from '../../../core/i18n';

interface ArchiveSidebarProps {
  filteredByFilters: ArchiveSession[];
  streakDays: number;
  statsTitle: string;
  onReset?: () => void;
  sessions: ArchiveSession[];
  sessionsByDate: Record<string, number>;
  selectedDate: Date | null;
  onSelectDate: (d: Date | null) => void;
  onSelectMonth: (d: Date | null) => void;
  wordCloud: { word: string; count: number }[];
  maxCount: number;
  onWordClick: (word: string) => void;
}

export function ArchiveSidebar({
  filteredByFilters, streakDays, statsTitle, onReset,
  sessions, sessionsByDate,
  selectedDate, onSelectDate, onSelectMonth,
  wordCloud, maxCount, onWordClick,
}: ArchiveSidebarProps) {
  const { t } = useLanguage();

  return (
    <div className="hidden lg:flex w-64 shrink-0 border-l border-border-subtle pl-6 flex-col gap-6 sticky top-0 self-start max-h-screen overflow-y-auto py-6 no-scrollbar">
      <div>
        <ArchiveStats
          sessions={filteredByFilters}
          streakDays={streakDays}
          title={statsTitle}
          onReset={onReset}
        />
      </div>

      <div className="h-px bg-border-subtle" />

      <div className="text-[11px] font-mono text-text-main/30 uppercase tracking-widest">
        {t('archive_calendar_title')}
      </div>

      <Calendar
        sessions={sessions}
        sessionsByDate={sessionsByDate}
        selectedDate={selectedDate ?? new Date()}
        onSelectDate={onSelectDate}
        onSelectMonth={onSelectMonth}
      />

      {wordCloud.length > 0 && (
        <div>
          <div className="font-mono text-[11px] text-text-main/30 uppercase tracking-widest mb-3">
            {t('archive_wordcloud_title')}
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-1.5">
            {wordCloud.map(({ word, count }) => {
              const size = 10 + Math.round((count / maxCount) * 8);
              const opacity = 0.3 + (count / maxCount) * 0.7;
              return (
                <button
                  key={word}
                  onClick={() => onWordClick(word)}
                  style={{ fontSize: size, opacity }}
                  className="text-text-main/70 hover:opacity-100 hover:text-brand-primary transition-all duration-200 leading-tight cursor-pointer"
                >
                  {word}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
