import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { ArchiveSession } from '../types';
import { ArchiveStats } from './ArchiveStats';
import { Calendar } from '../../calendar/components/Calendar';
import { useLanguage } from '../../../core/i18n';
import { Label } from '../../../types';
import { cn } from '../../../core/utils/utils';
import { LABEL_PRESET_COLORS } from '../../../core/constants/labelColors';

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
  onAddLabel?: (label: Omit<Label, 'id'>) => void;
}

export function ArchiveSidebar({
  filteredByFilters, streakDays, statsTitle, onReset,
  sessions, sessionsByDate,
  selectedDate, onSelectDate, onSelectMonth,
  wordCloud, maxCount, onWordClick,
  onAddLabel,
}: ArchiveSidebarProps) {
  const { t } = useLanguage();
  const [addingLabel, setAddingLabel] = useState(false);
  const [labelName, setLabelName] = useState('');
  const [labelColor, setLabelColor] = useState(LABEL_PRESET_COLORS[0]);

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

      {onAddLabel && (
        <div>
          <div className="font-mono text-[11px] text-text-main/30 uppercase tracking-widest mb-3">
            {t('archive_labels')}
          </div>
          <div className="space-y-1.5">
            {onAddLabel && !addingLabel && (
              <button
                onClick={() => setAddingLabel(true)}
                className="flex items-center gap-2 text-xs text-text-main/30 hover:text-text-main/50 transition-colors py-1"
              >
                <Plus size={12} />
                {t('archive_add_label')}
              </button>
            )}
            {onAddLabel && addingLabel && (
              <div className="space-y-2 pt-1 p-2 rounded-xl border border-border-subtle bg-surface-base">
                <input
                  value={labelName}
                  onChange={e => setLabelName(e.target.value)}
                  placeholder={t('archive_label_name_placeholder')}
                  className="w-full px-2 py-1.5 rounded-lg border border-border-subtle bg-surface-card text-xs text-text-main placeholder:text-text-main/25 outline-none focus:border-text-main/40 transition-colors"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const trimmed = labelName.trim();
                      if (trimmed) { onAddLabel({ name: trimmed, color: labelColor }); setLabelName(''); setAddingLabel(false); }
                    }
                    if (e.key === 'Escape') { setAddingLabel(false); setLabelName(''); }
                  }}
                />
                <div className="flex gap-1.5">
                  {LABEL_PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      style={{ background: c }}
                      className={cn("w-5 h-5 rounded-full transition-all", labelColor === c && "ring-2 ring-offset-1 ring-offset-surface-base")}
                      onClick={() => setLabelColor(c)}
                    />
                  ))}
                  <div className="relative">
                    <input
                      type="color"
                      defaultValue={labelColor}
                      onChange={e => setLabelColor(e.target.value)}
                      className="sr-only"
                      id="label-color-custom"
                    />
                    <label
                      htmlFor="label-color-custom"
                      className={cn(
                        "w-5 h-5 rounded-full border-2 border-dashed border-border-subtle flex items-center justify-center cursor-pointer transition-all hover:border-text-main/40",
                        !LABEL_PRESET_COLORS.includes(labelColor) && "ring-2 ring-offset-1 ring-offset-surface-base ring-text-main/30"
                      )}
                      style={!LABEL_PRESET_COLORS.includes(labelColor) ? { background: labelColor } : {}}
                    >
                      {LABEL_PRESET_COLORS.includes(labelColor) && (
                        <span className="text-[10px] text-text-main/40 font-bold leading-none">+</span>
                      )}
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { const trimmed = labelName.trim(); if (trimmed) { onAddLabel({ name: trimmed, color: labelColor }); setLabelName(''); setAddingLabel(false); } }}
                    disabled={!labelName.trim()}
                    className="flex-1 px-2 py-1.5 rounded-lg bg-text-main text-surface-base text-[11px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {t('common_save')}
                  </button>
                  <button
                    onClick={() => { setAddingLabel(false); setLabelName(''); }}
                    className="px-2 py-1.5 rounded-lg text-[11px] text-text-main/40 hover:text-text-main/60 transition-colors"
                  >
                    {t('common_cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
