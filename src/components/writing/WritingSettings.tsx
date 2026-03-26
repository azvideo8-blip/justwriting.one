import React from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../lib/i18n';

interface WritingSettingsProps {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  fontFamily: string;
  setFontFamily: (font: string) => void;
  textWidth: 'centered' | 'full';
  setTextWidth: (width: 'centered' | 'full') => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  zenModeEnabled: boolean;
  setZenModeEnabled: (enabled: boolean) => void;
  dynamicBgEnabled: boolean;
  setDynamicBgEnabled: (enabled: boolean) => void;
  stickyHeaderEnabled: boolean;
  setStickyHeaderEnabled: (enabled: boolean) => void;
  headerVisibility: {
    currentTime: boolean;
    sessionTime: boolean;
    sessionWords: boolean;
    totalWords: boolean;
    wpm: boolean;
  };
  setHeaderVisibility: (v: any) => void;
}

export function WritingSettings({ 
  showSettings, 
  setShowSettings, 
  fontFamily, 
  setFontFamily, 
  textWidth, 
  setTextWidth, 
  fontSize, 
  setFontSize,
  zenModeEnabled,
  setZenModeEnabled,
  dynamicBgEnabled,
  setDynamicBgEnabled,
  stickyHeaderEnabled,
  setStickyHeaderEnabled,
  headerVisibility,
  setHeaderVisibility
}: WritingSettingsProps) {
  const { t } = useLanguage();
  if (!showSettings) return null;

  const toggleVisibility = (key: keyof typeof headerVisibility) => {
    setHeaderVisibility({
      ...headerVisibility,
      [key]: !headerVisibility[key]
    });
  };

  return (
    <div className="fixed inset-0 z-[60] bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-stone-900 p-8 rounded-3xl max-w-md w-full space-y-8 shadow-2xl border border-stone-200 dark:border-stone-800 max-h-[90vh] overflow-y-auto no-scrollbar"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold">{t('settings_title')}</h3>
          <button 
            onClick={() => setShowSettings(false)}
            className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">{t('settings_font')}</label>
            <select 
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className="w-full bg-stone-50 dark:bg-stone-800 p-4 rounded-xl font-bold dark:text-stone-100 outline-none cursor-pointer"
            >
              <option value="Inter">Inter (Sans)</option>
              <option value="Playfair Display">Playfair (Serif)</option>
              <option value="JetBrains Mono">JetBrains (Mono)</option>
              <option value="Cormorant Garamond">Cormorant (Elegant)</option>
              <option value="Space Grotesk">Space (Modern)</option>
            </select>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">{t('settings_width')}</label>
            <div className="flex bg-stone-50 dark:bg-stone-800 p-1 rounded-xl">
              <button 
                onClick={() => setTextWidth('centered')}
                className={cn(
                  "flex-1 py-3 rounded-lg font-bold text-sm transition-all",
                  textWidth === 'centered' ? "bg-white dark:bg-stone-900 shadow-sm" : "text-stone-500"
                )}
              >
                {t('settings_width_centered')}
              </button>
              <button 
                onClick={() => setTextWidth('full')}
                className={cn(
                  "flex-1 py-3 rounded-lg font-bold text-sm transition-all",
                  textWidth === 'full' ? "bg-white dark:bg-stone-900 shadow-sm" : "text-stone-500"
                )}
              >
                {t('settings_width_full')}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">{t('settings_font_size')}: {fontSize}px</label>
            <input 
              type="range"
              min="14"
              max="32"
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="w-full h-2 bg-stone-100 dark:bg-stone-800 rounded-lg appearance-none cursor-pointer accent-stone-900 dark:accent-stone-100"
            />
          </div>

          <div className="space-y-4 pt-4 border-t border-stone-100 dark:border-stone-800">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <label className="text-sm font-bold">{t('settings_zen')}</label>
                <p className="text-[10px] text-stone-500">{t('settings_zen_desc')}</p>
              </div>
              <button 
                onClick={() => setZenModeEnabled(!zenModeEnabled)}
                className={cn(
                  "w-12 h-6 rounded-full transition-colors relative",
                  zenModeEnabled ? "bg-stone-900 dark:bg-stone-100" : "bg-stone-200 dark:bg-stone-800"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-4 h-4 rounded-full transition-all",
                  zenModeEnabled ? "right-1 bg-white dark:bg-stone-900" : "left-1 bg-white dark:bg-stone-400"
                )} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <label className="text-sm font-bold">{t('settings_dynamic_bg')}</label>
                <p className="text-[10px] text-stone-500">{t('settings_dynamic_bg_desc')}</p>
              </div>
              <button 
                onClick={() => setDynamicBgEnabled(!dynamicBgEnabled)}
                className={cn(
                  "w-12 h-6 rounded-full transition-colors relative",
                  dynamicBgEnabled ? "bg-stone-900 dark:bg-stone-100" : "bg-stone-200 dark:bg-stone-800"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-4 h-4 rounded-full transition-all",
                  dynamicBgEnabled ? "right-1 bg-white dark:bg-stone-900" : "left-1 bg-white dark:bg-stone-400"
                )} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <label className="text-sm font-bold">{t('settings_sticky')}</label>
                <p className="text-[10px] text-stone-500">{t('settings_sticky_desc')}</p>
              </div>
              <button 
                onClick={() => setStickyHeaderEnabled(!stickyHeaderEnabled)}
                className={cn(
                  "w-12 h-6 rounded-full transition-colors relative",
                  stickyHeaderEnabled ? "bg-stone-900 dark:bg-stone-100" : "bg-stone-200 dark:bg-stone-800"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-4 h-4 rounded-full transition-all",
                  stickyHeaderEnabled ? "right-1 bg-white dark:bg-stone-900" : "left-1 bg-white dark:bg-stone-400"
                )} />
              </button>
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-stone-100 dark:border-stone-800">
            <label className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">{t('settings_elements')}</label>
            
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'currentTime', label: t('writing_time') },
                { key: 'sessionTime', label: t('writing_timer') },
                { key: 'sessionWords', label: t('writing_words') },
                { key: 'totalWords', label: t('writing_total') },
                { key: 'wpm', label: t('writing_wpm') }
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => toggleVisibility(key as any)}
                  className={cn(
                    "px-3 py-2 rounded-lg text-[11px] font-bold transition-all border",
                    headerVisibility[key as keyof typeof headerVisibility]
                      ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 border-transparent"
                      : "bg-transparent border-stone-200 dark:border-stone-800 text-stone-500"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button 
          onClick={() => setShowSettings(false)}
          className="w-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 py-4 rounded-xl font-bold shadow-lg"
        >
          {t('settings_done')}
        </button>
      </motion.div>
    </div>
  );
}
