import React from 'react';
import { Clock } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { formatTime } from '../../../core/utils/formatTime';
import { useLanguage } from '../../../core/i18n';

interface ClassicHeaderStatsProps {
  status: string;
  wpm: number;
  wordCount: number;
  sessionWords: number;
  sessionSeconds: number;
  currentTime: Date;
  isPrimary: (type: 'words' | 'time' | 'wpm') => boolean;
  visibility: {
    currentTime: boolean;
    sessionTime: boolean;
    sessionWords: boolean;
    totalWords: boolean;
    wpm: boolean;
  };
  streamMode: boolean;
}

export function ClassicHeaderStats({
  status,
  wpm,
  wordCount,
  sessionWords,
  sessionSeconds,
  currentTime,
  isPrimary,
  visibility,
  streamMode
}: ClassicHeaderStatsProps) {
  const { t } = useLanguage();

  return (
    <div className="flex items-center gap-6 px-4 py-2 min-h-[44px]">
      {status === 'idle' ? (
        <div className="flex items-center gap-2 text-text-main/30">
          <Clock size={16} />
          <span className="text-sm font-medium">{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      ) : (
        <div className="flex items-center gap-7">
          {visibility.sessionTime && (
            <div className="flex flex-col gap-0">
              <span className={cn(
                "font-mono font-black transition-all",
                isPrimary('time') ? "text-2xl text-text-main" : "text-base text-text-main/60"
              )}>{formatTime(sessionSeconds)}</span>
              <span className="text-[10px] uppercase font-bold tracking-wider text-text-main/30 leading-none">{t('header_sessionTime')}</span>
            </div>
          )}

          {visibility.sessionWords && (
            <div className="flex flex-col gap-0">
              <span className={cn(
                "font-mono font-black transition-all",
                isPrimary('words') ? "text-2xl text-text-main" : "text-base text-text-main/60"
              )}>{sessionWords}</span>
              <span className="text-[10px] uppercase font-bold tracking-wider text-text-main/30 leading-none">{t('header_sessionWords')}</span>
            </div>
          )}

          {visibility.totalWords && (
            <div className="flex flex-col gap-0">
              <span className="font-mono font-black text-base text-text-main/60">{wordCount}</span>
              <span className="text-[10px] uppercase font-bold tracking-wider text-text-main/30 leading-none">{t('header_totalWords')}</span>
            </div>
          )}

          {visibility.wpm && (
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-0">
                <div className="flex items-center gap-1.5">
                  <span className={cn(
                    "font-mono font-black transition-all",
                    isPrimary('wpm') ? "text-2xl text-text-main" : "text-base text-text-main/60"
                  )}>{wpm}</span>
                  {status === 'writing' && (
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full animate-pulse transition-colors duration-500",
                      wpm === 0 ? "bg-stone-300" : wpm < 10 ? "bg-amber-400" : wpm < 20 ? "bg-lime-400" : "bg-emerald-500"
                    )} />
                  )}
                </div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-text-main/30 leading-none">{t('header_wpm')}</span>
              </div>
            </div>
          )}

          {status === 'writing' && streamMode && (
            <div className="flex items-center gap-2 text-indigo-500 animate-pulse">
              <div className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className="text-[11px] font-black uppercase tracking-widest">{t('header_in_flow')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
