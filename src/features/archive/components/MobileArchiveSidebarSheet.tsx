import { format, isSameDay } from 'date-fns';
import { SlidersHorizontal, X } from 'lucide-react';
import { ArchiveSession } from '../types';
import { ArchiveStats } from './ArchiveStats';
import { Calendar } from './Calendar';
import { useLanguage } from '../../../shared/i18n';
import { getDateLocale } from '../../../core/utils/dateUtils';
import { formatDayHeader } from '../utils/dayHeaders';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { ModalShell } from '../../../shared/components/ModalShell';

interface MobileArchiveSidebarSheetProps {
  isOpen: boolean;
  onClose: () => void;
  filteredByFilters: ArchiveSession[];
  streakDays: number;
  statsTitle: string;
  onReset?: (() => void) | undefined;
  sessions: ArchiveSession[];
  sessionsByDate: Record<string, number>;
  wordsByDate?: Record<string, number>;
  selectedDate: Date | null;
  onSelectDate: (d: Date | null) => void;
  onSelectMonth: (d: Date | null) => void;
  wordCloud: { word: string; count: number }[];
  maxCount: number;
  onWordClick: (word: string) => void;
}

export function MobileArchiveSidebarSheet({
  isOpen,
  onClose,
  filteredByFilters,
  streakDays,
  statsTitle,
  onReset,
  sessions,
  sessionsByDate,
  wordsByDate,
  selectedDate,
  onSelectDate,
  onSelectMonth,
  wordCloud,
  maxCount,
  onWordClick,
}: MobileArchiveSidebarSheetProps) {
  const { t, tp, language } = useLanguage();
  const locale = getDateLocale(language);
  // MC-7: счётчики ушли из заголовков списка сюда — в прокрутке заметки
  // читаются как текст, а цифры живут там, где их и спрашивают.
  const dayKeys = Object.keys(sessionsByDate).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()).slice(0, 10);

  const handleSelectWord = (word: string) => {
    onWordClick(word);
    onClose();
  };

  return (
    <ModalShell open={isOpen} onClose={onClose} labelId="archive-sidebar-sheet-title" variant="sheet">
        {/* Grab Handle */}
        <div className="flex justify-center py-3">
          <div className="w-12 h-1.5 rounded-full bg-white/10" />
        </div>

        {/* Header */}
        <div className="flex justify-between items-center px-6 pb-3">
          <div className="flex items-center gap-2 text-sm font-bold text-text-main/60 uppercase tracking-widest">
            <SlidersHorizontal size={16} />
            <span id="archive-sidebar-sheet-title">{t('archive_stats_title')}</span>
          </div>
          <IconButton
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/[0.04] border-none flex items-center justify-center text-text-main/60 hover:text-text-main/70 cursor-pointer"
            label={t('common_close')}
            icon={<X size={18} />}
          />
        </div>

        {/* Content */}
        <div className="px-6 overflow-y-auto no-scrollbar flex-1 space-y-6 pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
          {/* Stats section */}
          <div className="bg-white/[0.01] border border-white/[0.04] rounded-2xl p-4">
            <ArchiveStats
              sessions={filteredByFilters}
              streakDays={streakDays}
              title={statsTitle}
              onReset={onReset}
            />
          </div>

          <div className="h-px bg-white/[0.06]" />

          {/* Calendar Picker Section */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="font-mono text-label text-text-main/60 uppercase tracking-widest">
                {t('archive_calendar_title')}
              </span>
              {selectedDate && (
                <Button
                  onClick={() => onSelectDate(null)}
                  className="text-label font-mono text-brand-soft/80 hover:text-brand-soft flex items-center gap-1 bg-brand-soft/10 border border-brand-soft/20 rounded-lg px-2 py-0.5"
                >
                  ✕ {format(selectedDate, 'd MMM yyyy')}
                </Button>
              )}
            </div>

            <div className="flex justify-center bg-white/[0.01] border border-white/[0.04] rounded-2xl p-2">
              <Calendar
                sessions={sessions}
                sessionsByDate={sessionsByDate}
                wordsByDate={wordsByDate}
                selectedDate={selectedDate}
                onSelectDate={(d) => {
                  if (selectedDate && d && isSameDay(d, selectedDate)) {
                    onSelectDate(null);
                  } else {
                    onSelectMonth(null);
                    onSelectDate(d);
                  }
                }}
                onSelectMonth={(d) => {
                  onSelectDate(null);
                  onSelectMonth(d);
                }}
              />
            </div>
          </div>

          {dayKeys.length > 0 && (
            <>
              <div className="h-px bg-white/[0.06]" />

              <div className="space-y-3">
                <span className="font-mono text-label text-text-main/60 uppercase tracking-widest block">
                  {t('archive_days_counts_title')}
                </span>
                <div className="rounded-2xl border border-white/[0.04] bg-white/[0.01] divide-y divide-white/[0.04]">
                  {dayKeys.map(key => (
                    <div key={key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                      <span className="min-w-0 truncate text-text-main">{formatDayHeader(key, t, locale)}</span>
                      <span className="shrink-0 text-text-main/60">
                        {tp('archive_note_count', sessionsByDate[key] ?? 0)} · {tp('archive_word_count', wordsByDate?.[key] ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {wordCloud.length > 0 && (
            <>
              <div className="h-px bg-white/[0.06]" />

              {/* Word Cloud Tag list */}
              <div className="space-y-3">
                <span className="font-mono text-label text-text-main/60 uppercase tracking-widest block">
                  {t('archive_wordcloud_title')}
                </span>
                <div className="flex flex-wrap gap-x-3 gap-y-2 bg-white/[0.01] border border-white/[0.04] rounded-2xl p-4">
                  {wordCloud.map(({ word, count }) => {
                    const size = 11 + Math.round((count / maxCount) * 8);
                    const opacity = 0.4 + (count / maxCount) * 0.6;
                    return (
                      <Button
                        key={word}
                        onClick={() => handleSelectWord(word)}
                        style={{ fontSize: size, opacity }}
                        className="text-text-main/70 active:text-brand-primary active:opacity-100 transition-colors leading-tight cursor-pointer py-1 p-0 min-w-0"
                      >
                        {word}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Close Button */}
          <div className="pt-2">
            <Button
              onClick={onClose}
              className="w-full py-3.5 rounded-2xl font-bold text-sm text-surface-base border-none cursor-pointer text-center active:scale-[0.98] transition-colors bg-[var(--brand-primary)]"
            >
              {t('common_close')}
            </Button>
          </div>
        </div>
    </ModalShell>
  );
}
