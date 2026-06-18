import { useState } from 'react';
import { motion } from 'motion/react';
import { Target, Timer, X, Check } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { useTimerStore } from '../store/useTimerStore';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';

interface MobileGoalSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

const WORD_PRESETS = [0, 100, 250, 500, 750, 1000, 1500, 2000];
const TIME_PRESETS = [0, 5, 10, 15, 25, 45, 60];

export function MobileGoalSheet({ isOpen, onClose }: MobileGoalSheetProps) {
  const { t } = useLanguage();
  const { wordGoal, setWordGoal, timerDuration, setTimerDuration } = useTimerStore();

  const [customWords, setCustomWords] = useState(wordGoal > 0 ? String(wordGoal) : '');
  const [customMins, setCustomMins] = useState(timerDuration > 0 ? String(Math.round(timerDuration / 60)) : '');

  if (!isOpen) return null;

  const triggerVibration = () => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(60);
      } catch {
        // Safe fallback if vibration API is blocked
      }
    }
  };

  const handleSelectWords = (words: number) => {
    setWordGoal(words);
    setCustomWords(words > 0 ? String(words) : '');
    triggerVibration();
  };

  const handleSelectMins = (mins: number) => {
    setTimerDuration(mins * 60);
    setCustomMins(mins > 0 ? String(mins) : '');
    triggerVibration();
  };

  const handleApplyCustomWords = () => {
    const val = parseInt(customWords);
    if (!isNaN(val) && val >= 0) {
      setWordGoal(val);
      triggerVibration();
    }
  };

  const handleApplyCustomMins = () => {
    const val = parseInt(customMins);
    if (!isNaN(val) && val >= 0) {
      setTimerDuration(val * 60);
      triggerVibration();
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[var(--z-sheet)] flex items-end justify-center bg-black/60 backdrop-blur-sm touch-none"
      onTouchMove={e => e.preventDefault()}
    >
      {/* Dismiss Tap Area */}
      <div className="absolute inset-0" onClick={onClose} />

      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="relative z-10 w-full max-w-lg bg-surface-card border-t border-white/[0.06] rounded-t-[28px] overflow-hidden flex flex-col max-h-[85vh] shadow-[0_-8px_32px_rgba(0,0,0,0.4)] pb-safe"
        
      >
        {/* Grab Handle */}
        <div className="flex justify-center py-3">
          <div className="w-12 h-1.5 rounded-full bg-white/10" />
        </div>

        {/* Header */}
        <div className="flex justify-between items-center px-6 pb-3">
          <span className="text-sm font-bold text-text-main/60 uppercase tracking-widest">
            {t('settings_goals') || 'Цели'}
          </span>
          <IconButton
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/[0.04] border-none flex items-center justify-center text-text-main/60 hover:text-text-main/70 cursor-pointer"
            label={t('close')}
            icon={<X size={18} />}
          />
        </div>

        <div className="px-6 pb-8 overflow-y-auto no-scrollbar flex-1 space-y-6">
          {/* Words Goal Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-text-main/80 font-semibold text-sm">
              <Target size={18} className="text-rose-400" />
              <span>{t('writing_mode_words') || 'Цель по словам'}</span>
            </div>

            {/* Presets Grid */}
            <div className="grid grid-cols-4 gap-2">
              {WORD_PRESETS.map((words) => (
                <Button
                  key={words}
                  onClick={() => handleSelectWords(words)}
                  className={cn(
                    "py-2 px-1 rounded-xl text-xs font-semibold border transition-colors cursor-pointer text-center",
                    wordGoal === words
                      ? "bg-rose-400/10 border-rose-400 text-rose-400"
                      : "bg-white/[0.02] border-white/[0.06] text-text-main/60"
                  )}
                >
                  {words === 0 ? t('archive_stats_reset') || 'Без цели' : `${words} сл.`}
                </Button>
              ))}
            </div>

            {/* Custom Input */}
            <div className="flex gap-2.5 items-center bg-white/[0.02] border border-white/[0.06] rounded-xl px-3 py-1">
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder={t('writing_words') || 'Количество слов'}
                value={customWords}
                onChange={(e) => setCustomWords(e.target.value)}
                onBlur={handleApplyCustomWords}
                onKeyDown={(e) => e.key === 'Enter' && handleApplyCustomWords()}
                className="flex-1 bg-transparent border-none outline-none py-2 text-sm text-text-main"
              />
              {customWords && (
                <IconButton
                  onClick={handleApplyCustomWords}
                  className="w-7 h-7 rounded-lg bg-rose-400/10 text-rose-400 flex items-center justify-center border-none cursor-pointer"
                  label={t('apply') || 'Apply'}
                  icon={<Check size={14} />}
                />
              )}
            </div>
          </div>

          {/* Time Goal Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-text-main/80 font-semibold text-sm">
              <Timer size={18} className="text-blue-400" />
              <span>{t('writing_mode_timer') || 'Цель по времени'}</span>
            </div>

            {/* Presets Grid */}
            <div className="grid grid-cols-4 gap-2">
              {TIME_PRESETS.map((mins) => (
                <Button
                  key={mins}
                  onClick={() => handleSelectMins(mins)}
                  className={cn(
                    "py-2 px-1 rounded-xl text-xs font-semibold border transition-colors cursor-pointer text-center",
                    Math.round(timerDuration / 60) === mins
                      ? "bg-blue-400/10 border-blue-400 text-blue-400"
                      : "bg-white/[0.02] border-white/[0.06] text-text-main/60"
                  )}
                >
                  {mins === 0 ? t('archive_stats_reset') || 'Без цели' : `${mins} мин.`}
                </Button>
              ))}
            </div>

            {/* Custom Input */}
            <div className="flex gap-2.5 items-center bg-white/[0.02] border border-white/[0.06] rounded-xl px-3 py-1">
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder={t('writing_minutes') || 'Минут'}
                value={customMins}
                onChange={(e) => setCustomMins(e.target.value)}
                onBlur={handleApplyCustomMins}
                onKeyDown={(e) => e.key === 'Enter' && handleApplyCustomMins()}
                className="flex-1 bg-transparent border-none outline-none py-2 text-sm text-text-main"
              />
              {customMins && (
                <IconButton
                  onClick={handleApplyCustomMins}
                  className="w-7 h-7 rounded-lg bg-blue-400/10 text-blue-400 flex items-center justify-center border-none cursor-pointer"
                  label={t('apply') || 'Apply'}
                  icon={<Check size={14} />}
                />
              )}
            </div>
          </div>

          {/* Close Button */}
          <div className="pt-2">
            <Button
              onClick={onClose}
              className="w-full py-3.5 rounded-2xl font-bold text-sm text-surface-base border-none cursor-pointer text-center active:scale-[0.98] transition-colors bg-[var(--brand-primary)]"
            >
              {t('save_success') || 'Готово'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
