import React from 'react';
import { motion } from 'motion/react';
import { format, isSameDay } from 'date-fns';
import { SlidersHorizontal, X } from 'lucide-react';
import { ArchiveSession } from '../types';
import { ArchiveStats } from './ArchiveStats';
import { Calendar } from '../../calendar/components/Calendar';
import { useLanguage } from '../../../core/i18n';

interface MobileArchiveSidebarSheetProps {
  isOpen: boolean;
  onClose: () => void;
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

export function MobileArchiveSidebarSheet({
  isOpen,
  onClose,
  filteredByFilters,
  streakDays,
  statsTitle,
  onReset,
  sessions,
  sessionsByDate,
  selectedDate,
  onSelectDate,
  onSelectMonth,
  wordCloud,
  maxCount,
  onWordClick,
}: MobileArchiveSidebarSheetProps) {
  const { t } = useLanguage();

  if (!isOpen) return null;

  const handleSelectWord = (word: string) => {
    onWordClick(word);
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm touch-none"
      onTouchMove={e => e.preventDefault()}
    >
      {/* Dismiss overlay */}
      <div className="absolute inset-0" onClick={onClose} />

      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="relative z-10 w-full max-w-lg bg-surface-card border-t border-white/[0.06] rounded-t-[28px] overflow-hidden flex flex-col max-h-[85vh] shadow-[0_-8px_32px_rgba(0,0,0,0.4)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}
      >
        {/* Grab Handle */}
        <div className="flex justify-center py-3">
          <div className="w-12 h-1.5 rounded-full bg-white/10" />
        </div>

        {/* Header */}
        <div className="flex justify-between items-center px-6 pb-3">
          <div className="flex items-center gap-2 text-sm font-bold text-text-main/30 uppercase tracking-widest">
            <SlidersHorizontal size={16} />
            <span>{t('archive_stats_title') || 'Фильтры'}</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/[0.04] border-none flex items-center justify-center text-text-main/40 hover:text-text-main/70 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-8 overflow-y-auto no-scrollbar flex-1 space-y-6"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)' }}>
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
              <span className="font-mono text-[10px] text-text-main/30 uppercase tracking-widest">
                {t('archive_calendar_title')}
              </span>
              {selectedDate && (
                <button
                  onClick={() => onSelectDate(null)}
                  className="text-[10px] font-mono text-brand-soft/80 hover:text-brand-soft flex items-center gap-1 bg-brand-soft/10 border border-brand-soft/20 rounded-lg px-2 py-0.5"
                >
                  ✕ {format(selectedDate, 'd MMM yyyy')}
                </button>
              )}
            </div>

            <div className="flex justify-center bg-white/[0.01] border border-white/[0.04] rounded-2xl p-2">
              <Calendar
                sessions={sessions}
                sessionsByDate={sessionsByDate}
                selectedDate={selectedDate ?? new Date()}
                onSelectDate={(d) => {
                  if (selectedDate && isSameDay(d, selectedDate)) {
                    onSelectDate(null);
                  } else {
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

          {wordCloud.length > 0 && (
            <>
              <div className="h-px bg-white/[0.06]" />

              {/* Word Cloud Tag list */}
              <div className="space-y-3">
                <span className="font-mono text-[10px] text-text-main/30 uppercase tracking-widest block">
                  {t('archive_wordcloud_title')}
                </span>
                <div className="flex flex-wrap gap-x-3 gap-y-2 bg-white/[0.01] border border-white/[0.04] rounded-2xl p-4">
                  {wordCloud.map(({ word, count }) => {
                    const size = 11 + Math.round((count / maxCount) * 8);
                    const opacity = 0.4 + (count / maxCount) * 0.6;
                    return (
                      <button
                        key={word}
                        onClick={() => handleSelectWord(word)}
                        style={{ fontSize: size, opacity }}
                        className="text-text-main/70 active:text-brand-primary active:opacity-100 transition-all leading-tight cursor-pointer py-1"
                      >
                        {word}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Close Button */}
          <div className="pt-2">
            <button
              onClick={onClose}
              style={{ background: 'var(--brand-primary)' }}
              className="w-full py-3.5 rounded-2xl font-bold text-sm text-surface-base border-none cursor-pointer text-center active:scale-[0.98] transition-all"
            >
              {t('common_close') || 'Закрыть'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
