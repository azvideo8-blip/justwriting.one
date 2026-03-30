import React from 'react';
import { motion } from 'motion/react';
import { X, Type, Moon, Eye } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { useSettingsV2 } from '../../settings/hooks/useSettingsV2';
import { useUI } from '../../../contexts/UIContext';

export function SettingsV2({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const settings = useSettingsV2();
  const { streamMode, toggleStreamMode } = useUI();

  const visibilityLabels: Record<string, string> = {
    currentTime: t('writing_time'),
    sessionTime: t('writing_timer'),
    sessionWords: t('writing_words'),
    totalWords: t('writing_total'),
    wpm: t('writing_wpm'),
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-3xl bg-black/80 theme-v2">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg rounded-[2.5rem] flex flex-col max-h-[90vh] overflow-hidden bg-[var(--v2-bg)] border border-[var(--v2-border)] shadow-[0_0_50px_rgba(0,0,0,1)]"
      >
        {/* Header */}
        <div className="p-8 flex items-center justify-between border-b border-[var(--v2-border)]">
          <h3 className="text-[var(--v2-white-high)] text-2xl font-black tracking-tight m-0">{t('settings_title')}</h3>
          <button onClick={onClose} className="text-[var(--v2-white-low)] hover:text-[var(--v2-white-high)] transition-colors">
            <X size={28} />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 overflow-y-auto space-y-10">
          
          {/* Typography */}
          <section>
            <label className="text-[var(--v2-white-low)] text-[10px] font-bold uppercase tracking-[0.3em] block mb-4">
               {t('settings_font')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              {['Inter', 'Playfair Display', 'JetBrains Mono', 'Cormorant Garamond', 'Space Grotesk'].map(font => {
                const isActive = settings.fontFamily === font;
                return (
                  <button
                    key={font}
                    onClick={() => settings.setFontFamily(font)}
                    className={cn(
                      "py-3 px-4 rounded-xl transition-all font-bold",
                      isActive 
                        ? "bg-[var(--v2-white-high)] text-black border border-[var(--v2-white-high)]" 
                        : "bg-[var(--v2-glass)] text-[var(--v2-white-high)] border border-[var(--v2-border)] hover:bg-[var(--v2-white-high)]/10"
                    )}
                  >
                    {font}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Stream Mode & Toggles */}
          <section className="space-y-4">
            <label className="text-[var(--v2-white-low)] text-[10px] font-bold uppercase tracking-[0.3em] block">
               {t('settings_zen')}
            </label>
            {[
              { label: t('settings_zen'), val: settings.zenMode, set: settings.setZenMode },
              { label: "Stream Mode", val: streamMode, set: toggleStreamMode }
            ].map(item => (
              <div 
                key={item.label}
                onClick={() => item.set(!item.val)}
                className="flex items-center justify-between p-5 rounded-2xl cursor-pointer bg-[var(--v2-glass)] border border-[var(--v2-border)] hover:bg-[var(--v2-white-high)]/5 transition-all"
              >
                <span className="text-[var(--v2-white-high)] font-bold">{item.label}</span>
                <div className={cn(
                  "w-12 h-6 rounded-full relative transition-colors duration-300",
                  item.val ? "bg-[var(--v2-white-high)]" : "bg-[var(--v2-white-low)]/20"
                )}>
                  <div className={cn(
                    "w-4 h-4 rounded-full absolute top-1 transition-all duration-300",
                    item.val ? "left-[28px] bg-black" : "left-1 bg-[var(--v2-white-low)]"
                  )} />
                </div>
              </div>
            ))}
          </section>

          {/* Visibility Grid */}
          <section>
            <label className="text-[var(--v2-white-low)] text-[10px] font-bold uppercase tracking-[0.3em] block mb-4">
               {t('settings_elements')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              {Object.keys(settings.headerVisibility).map(key => {
                const isActive = settings.headerVisibility[key];
                return (
                  <button
                    key={key}
                    onClick={() => settings.toggleVisibility(key)}
                    className={cn(
                      "py-3 px-4 rounded-xl flex items-center justify-between transition-all font-bold",
                      isActive 
                        ? "bg-[var(--v2-white-high)] text-black border border-[var(--v2-white-high)]" 
                        : "bg-[var(--v2-glass)] text-[var(--v2-white-high)] border border-[var(--v2-border)] hover:bg-[var(--v2-white-high)]/10"
                    )}
                  >
                    {visibilityLabels[key] || key}
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      isActive ? "bg-black" : "bg-[var(--v2-white-low)]"
                    )} />
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="p-8 border-t border-[var(--v2-border)]">
          <button 
            onClick={onClose}
            className="w-full py-5 rounded-2xl bg-[var(--v2-white-high)] text-black font-black uppercase tracking-[0.2em] transition-all hover:scale-[1.02] active:scale-[0.98] shadow-[0_10px_30px_rgba(255,255,255,0.1)]"
          >
            {t('settings_done')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
