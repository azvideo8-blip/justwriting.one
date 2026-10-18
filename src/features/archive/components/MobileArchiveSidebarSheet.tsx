import { useState } from 'react';
import { format, isSameDay } from 'date-fns';
import { SlidersHorizontal, X } from 'lucide-react';
import { ArchiveSession } from '../types';
import { ArchiveStats } from './ArchiveStats';
import { Calendar } from './Calendar';
import { useLanguage } from '../../../shared/i18n';
import { getDateLocale } from '../../../core/utils/dateUtils';
import { formatDayHeader } from '../utils/dayHeaders';
import { Button } from '../../../shared/components/Button';
import { cn } from '../../../core/utils/utils';
import { IconButton } from '../../../shared/components/IconButton';
import { ModalShell, SECTION_LABEL } from '../../../shared/components/ModalShell';

interface MobileArchiveSidebarSheetProps {
  isOpen: boolean;
  onClose: () => void;
  filteredByFilters: ArchiveSession[];
  streakDays: number;
  statsTitle: string;
  onReset?: (() => void) | undefined;
  sessions: ArchiveSession[];
  sessionsByDate: Record<string, number>;
  wordsByDate?: Record<string, number> | undefined;
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
  const { t } = useLanguage();

  const handleSelectWord = (word: string) => {
    onWordClick(word);
    onClose();
  };

  return (
    <ModalShell open={isOpen} onClose={onClose} labelId="archive-sidebar-sheet-title" variant="sheet">
        {/* SA-23: ручку убрали — перетаскивания у листа нет, а ручка его обещала. */}
        <div className="h-3" aria-hidden="true" />

        {/* Header */}
        <div className="flex justify-between items-center px-6 pb-3">
          <div className={`flex items-center gap-2 ${SECTION_LABEL}`}>
            <SlidersHorizontal size={16} />
            <span id="archive-sidebar-sheet-title">{t('archive_stats_title')}</span>
          </div>
          <IconButton
            onClick={onClose}
            className="w-11 h-11 rounded-xl"
            label={t('common_close')}
            icon={<X size={18} />}
          />
        </div>

        {/* Content */}
        <div className="px-6 overflow-y-auto no-scrollbar flex-1 space-y-6 pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
          <ArchiveSidebarContent
            filteredByFilters={filteredByFilters} streakDays={streakDays} statsTitle={statsTitle} onReset={onReset}
            sessions={sessions} sessionsByDate={sessionsByDate} wordsByDate={wordsByDate} selectedDate={selectedDate}
            onSelectDate={onSelectDate} onSelectMonth={onSelectMonth} wordCloud={wordCloud} maxCount={maxCount}
            onWordClick={handleSelectWord}
          />

          {/* Close Button */}
          <div className="pt-2">
            <Button
              onClick={onClose}
              className="w-full py-3.5 rounded-2xl font-bold text-sm text-surface-base border-none cursor-pointer text-center press bg-[var(--brand-primary)]"
            >
              {t('common_close')}
            </Button>
          </div>
        </div>
    </ModalShell>
  );
}

type SidebarContentProps = Omit<MobileArchiveSidebarSheetProps, 'isOpen' | 'onClose'> & {
  /** MF-17: во встроенной панели облако слов свёрнуто за «Облако слов ›» — иначе панель выше экрана. */
  collapseCloud?: boolean | undefined;
  /** MQ-8: во встроенной панели на телефоне — одна плоская поверхность, без вложенных карточек. */
  flat?: boolean | undefined;
};

/** Календарь, статистика, дни и облако слов — общее содержимое листа (десктоп
 *  на узком окне) и встроенной панели над заметками на телефоне (MF-17). */
export function ArchiveSidebarContent({
  filteredByFilters, streakDays, statsTitle, onReset, sessions, sessionsByDate, wordsByDate,
  selectedDate, onSelectDate, onSelectMonth, wordCloud, maxCount, onWordClick, collapseCloud, flat = false,
}: SidebarContentProps) {
  const [cloudOpen, setCloudOpen] = useState(!collapseCloud);
  const { t, tp, language } = useLanguage();
  const locale = getDateLocale(language);
  // MC-7: счётчики ушли из заголовков списка сюда — в прокрутке заметки
  // читаются как текст, а цифры живут там, где их и спрашивают.
  const dayKeys = Object.keys(sessionsByDate).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()).slice(0, 10);
  const handleSelectWord = onWordClick;
  return (
    <>
          {/* Stats section */}
          <div className={flat ? undefined : 'bg-text-main/[0.02] border border-border-subtle rounded-2xl p-4'}>
            <ArchiveStats
              sessions={filteredByFilters}
              streakDays={streakDays}
              title={statsTitle}
              onReset={onReset}
              flat={flat}
            />
          </div>

          {!flat && <div className="h-px bg-border-subtle" />}

          {/* Calendar Picker Section */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              {/* MQ-8: во встроенной панели название «Календарь» уже в её шапке. */}
              {flat ? <span /> : (
                <span className={SECTION_LABEL}>
                  {t('archive_calendar_title')}
                </span>
              )}
              {selectedDate && (
                <Button
                  onClick={() => onSelectDate(null)}
                  className={flat
                    ? 'min-h-11 text-[13px] font-medium text-brand-soft flex items-center gap-1 rounded-lg px-3'
                    : 'text-label font-mono text-brand-soft/80 hover:text-brand-soft flex items-center gap-1 bg-brand-soft/10 border border-brand-soft/20 rounded-lg px-2 py-0.5'}
                >
                  ✕ {format(selectedDate, 'd MMM yyyy')}
                </Button>
              )}
            </div>

            <div className={flat ? undefined : 'flex justify-center bg-text-main/[0.02] border border-border-subtle rounded-2xl p-2'}>
              <Calendar
                flat={flat}
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
              {!flat && <div className="h-px bg-border-subtle" />}

              <div className="space-y-3">
                <span className={`${SECTION_LABEL} block`}>
                  {t('archive_days_counts_title')}
                </span>
                <div className={flat ? 'divide-y divide-border-subtle' : 'rounded-2xl border border-border-subtle bg-text-main/[0.02] divide-y divide-border-subtle'}>
                  {dayKeys.map(key => (
                    <div key={key} className={cn('flex items-center justify-between gap-3 py-2.5 text-[13px]', !flat && 'px-4')}>
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

          {wordCloud.length > 0 && !cloudOpen && (
            <Button onClick={() => setCloudOpen(true)} className="min-h-11 w-full justify-between px-0 text-sm text-text-main/70">
              {t('archive_wordcloud_title')} ›
            </Button>
          )}
          {wordCloud.length > 0 && cloudOpen && (
            <>
              {!flat && <div className="h-px bg-border-subtle" />}

              {/* Word Cloud Tag list */}
              <div className="space-y-3">
                <span className={`${SECTION_LABEL} block`}>
                  {t('archive_wordcloud_title')}
                </span>
                <div className={cn('flex flex-wrap gap-x-3 gap-y-2', !flat && 'bg-text-main/[0.02] border border-border-subtle rounded-2xl p-4')}>
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
    </>
  );
}
