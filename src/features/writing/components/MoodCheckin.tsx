import React from 'react';
import { motion } from 'motion/react';
import { useLanguage } from '../../../core/i18n';

interface MoodCheckinProps {
  onSelect: (mood: number) => void;
  onSkip: () => void;
}

export function MoodCheckin({ onSelect, onSkip }: MoodCheckinProps) {
  const { t } = useLanguage();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-base/80 backdrop-blur-2xl">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md rounded-3xl p-8 bg-surface-card backdrop-blur-2xl border border-border-subtle text-text-main shadow-[0_0_60px_rgba(0,0,0,0.8)]"
      >
        <div className="text-center space-y-6 py-4">
          <div>
            <div className="text-2xl font-bold text-text-main">{t('mood_checkin_title')}</div>
            <div className="text-sm text-text-main/40 mt-1">{t('mood_checkin_subtitle')}</div>
          </div>
          <div className="flex justify-center gap-4">
            {(['😊', '🙂', '😐', '😔', '😤'] as const).map((emoji, i) => (
              <button
                key={i}
                onClick={() => onSelect(i + 1)}
                className="text-4xl hover:scale-125 transition-transform active:scale-95"
              >
                {emoji}
              </button>
            ))}
          </div>
          <button
            onClick={onSkip}
            className="text-xs text-text-main/30 hover:text-text-main/50 transition-colors"
          >
            {t('mood_checkin_skip')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
