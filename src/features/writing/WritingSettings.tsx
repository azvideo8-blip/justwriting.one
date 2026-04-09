import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Type, Maximize2, Moon, Palette, Pin, Eye, Zap } from 'lucide-react';
import { cn } from '../../core/utils/utils';
import { useLanguage } from '../../core/i18n';
import { useUI } from '../../contexts/UIContext';
import { useWritingSettings } from './contexts/WritingSettingsContext';

interface WritingSettingsProps {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  fontFamily: string;
  setFontFamily: (font: string) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
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
  setShowSettings
}: { 
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
}) {
  const { t } = useLanguage();
  const settings = useWritingSettings();

  if (!showSettings) return null;

  const toggleVisibility = (key: keyof typeof settings.headerVisibility) => {
    settings.toggleVisibility(key);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-surface-base/60 backdrop-blur-2xl">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-lg rounded-[2.5rem] overflow-hidden flex flex-col max-h-[90vh] bg-surface-card backdrop-blur-2xl border border-border-subtle text-text-main"
        >
          <div className="p-6 md:p-8 border-b border-border-subtle flex items-center justify-between sticky top-0 z-10 bg-surface-card backdrop-blur-xl">
            <h3 className="text-xl md:text-2xl font-black tracking-tight text-text-main">{t('settings_title')}</h3>
            <button 
              onClick={() => setShowSettings(false)}
              className="p-2 rounded-full transition-colors hover:bg-white/10 text-text-main/50 hover:text-text-main"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-6 md:p-8 overflow-y-auto no-scrollbar space-y-8 md:space-y-10">
            {/* Typography */}
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-white/10 text-text-main">
                  <Type size={16} />
                </div>
                <h4 className="font-bold text-[11px] uppercase tracking-[0.2em] text-text-main/50">{t('settings_font')}</h4>
              </div>
              
              <div className="space-y-4">
                <div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { id: 'Inter', label: 'Inter (Sans)', class: 'font-sans' },
                      { id: 'Playfair Display', label: 'Playfair (Serif)', class: 'font-serif' },
                      { id: 'JetBrains Mono', label: 'JetBrains (Mono)', class: 'font-mono' },
                      { id: 'Cormorant Garamond', label: 'Cormorant (Elegant)', class: 'font-serif' },
                      { id: 'Space Grotesk', label: 'Space (Modern)', class: 'font-sans' }
                    ].map(font => (
                      <button
                        key={font.id}
                        onClick={() => settings.setFontFamily(font.id)}
                        className={cn(
                          "py-3 px-4 rounded-2xl text-base transition-all border font-bold",
                          font.class,
                          settings.fontFamily === font.id 
                            ? "bg-text-main text-surface-base border-text-main"
                            : "bg-transparent border-border-subtle text-text-main/60 hover:bg-white/10 hover:text-text-main"
                        )}
                      >
                        {font.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-[11px] uppercase tracking-[0.2em] text-text-main/50">{t('settings_font_size')}</label>
                    <span className="text-xs font-bold text-text-main">{settings.fontSize}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="14" 
                    max="32" 
                    value={settings.fontSize}
                    onChange={(e) => settings.setFontSize(Number(e.target.value))}
                    className="w-full h-1 bg-white/20 rounded-full appearance-none accent-text-main"
                  />
                </div>
              </div>
            </div>

            {/* Layout */}
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-white/10 text-text-main">
                  <Maximize2 size={16} />
                </div>
                <h4 className="font-bold text-[11px] uppercase tracking-[0.2em] text-text-main/50">{t('settings_width')}</h4>
              </div>

              <div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'centered', label: t('settings_width_centered') },
                    { id: 'full', label: t('settings_width_full') }
                  ].map(width => (
                    <button
                      key={width.id}
                      onClick={() => settings.setTextWidth(width.id as 'centered' | 'full')}
                      className={cn(
                        "py-3 px-4 rounded-2xl text-sm transition-all font-bold border",
                        settings.textWidth === width.id 
                          ? "bg-text-main text-surface-base border-text-main"
                          : "bg-transparent border-border-subtle text-text-main/60 hover:bg-white/10 hover:text-text-main"
                      )}
                    >
                      {width.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Experience */}
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-white/10 text-text-main">
                  <Palette size={16} />
                </div>
                <h4 className="font-bold text-[11px] uppercase tracking-[0.2em] text-text-main/50">{t('settings_zen')}</h4>
              </div>

              <div className="space-y-3">
                <div 
                  onClick={() => settings.setZenModeEnabled(!settings.zenModeEnabled)}
                  className={cn(
                    "p-4 rounded-2xl flex items-center justify-between cursor-pointer transition-all border",
                    settings.zenModeEnabled ? "bg-text-main border-text-main" : "bg-transparent border-border-subtle hover:bg-white/10"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Moon size={18} className={settings.zenModeEnabled ? "text-surface-base" : "text-text-main/50"} />
                    <div>
                      <div className={cn("font-bold text-base", settings.zenModeEnabled ? "text-surface-base" : "text-text-main")}>{t('settings_zen')}</div>
                      <div className={cn("text-[10px] uppercase tracking-[0.2em]", settings.zenModeEnabled ? "text-surface-base/50" : "text-text-main/50")}>{t('settings_zen_desc')}</div>
                    </div>
                  </div>
                  <div className={cn(
                    "w-12 h-6 rounded-full transition-all duration-500 relative shrink-0", 
                    settings.zenModeEnabled ? "bg-surface-base" : "bg-white/10"
                  )}>
                    <div className={cn(
                      "absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-500", 
                      settings.zenModeEnabled ? "translate-x-6" : "translate-x-0"
                    )} />
                  </div>
                </div>

                <div 
                  onClick={settings.toggleStreamMode}
                  className={cn(
                    "p-4 rounded-2xl flex items-center justify-between cursor-pointer transition-all border",
                    settings.streamMode ? "bg-text-main border-text-main" : "bg-transparent border-border-subtle hover:bg-white/10"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Zap size={18} className={settings.streamMode ? "text-surface-base" : "text-text-main/50"} />
                    <div>
                      <div className={cn("font-bold text-base", settings.streamMode ? "text-surface-base" : "text-text-main")}>{t('settings_stream_mode')}</div>
                      <div className={cn("text-[10px] uppercase tracking-[0.2em]", settings.streamMode ? "text-surface-base/50" : "text-text-main/50")}>{t('settings_stream_mode_desc')}</div>
                    </div>
                  </div>
                  <div className={cn(
                    "w-12 h-6 rounded-full transition-all duration-500 relative shrink-0", 
                    settings.streamMode ? "bg-surface-base" : "bg-white/10"
                  )}>
                    <div className={cn(
                      "absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-500", 
                      settings.streamMode ? "translate-x-6" : "translate-x-0"
                    )} />
                  </div>
                </div>
              </div>
            </div>

            {/* Header Configuration */}
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-white/10 text-text-main">
                  <Pin size={16} />
                </div>
                <h4 className="font-bold text-[11px] uppercase tracking-[0.2em] text-text-main/50">{t('settings_sticky')}</h4>
              </div>

              <div className="space-y-3">
                <div 
                  onClick={() => settings.setStickyHeader(!settings.stickyHeader)}
                  className={cn(
                    "p-4 rounded-2xl flex items-center justify-between cursor-pointer transition-all border",
                    settings.stickyHeader ? "bg-text-main border-text-main" : "bg-transparent border-border-subtle hover:bg-white/10"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Pin size={18} className={settings.stickyHeader ? "text-surface-base" : "text-text-main/50"} />
                    <div>
                      <div className={cn("font-bold text-base", settings.stickyHeader ? "text-surface-base" : "text-text-main")}>{t('settings_sticky')}</div>
                      <div className={cn("text-[10px] uppercase tracking-[0.2em]", settings.stickyHeader ? "text-surface-base/50" : "text-text-main/50")}>{t('settings_sticky_desc')}</div>
                    </div>
                  </div>
                  <div className={cn(
                    "w-12 h-6 rounded-full transition-all duration-500 relative shrink-0", 
                    settings.stickyHeader ? "bg-surface-base" : "bg-white/10"
                  )}>
                    <div className={cn(
                      "absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-500", 
                      settings.stickyHeader ? "translate-x-6" : "translate-x-0"
                    )} />
                  </div>
                </div>

                <div className="p-5 rounded-2xl space-y-4 bg-white/5 border border-border-subtle">
                  <div className="flex items-center gap-2 mb-2">
                    <Eye size={14} className="text-text-main/50" />
                    <span className="text-[10px] uppercase tracking-[0.2em] text-text-main/50">{t('settings_elements')}</span>
                  </div>
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
                        onClick={() => toggleVisibility(key as keyof typeof settings.headerVisibility)}
                        className={cn(
                          "py-3 px-4 rounded-xl text-sm font-bold transition-all flex items-center justify-between border",
                          settings.headerVisibility[key as keyof typeof settings.headerVisibility]
                            ? "bg-text-main text-surface-base border-text-main"
                            : "bg-transparent border-border-subtle text-text-main/60 hover:bg-white/10 hover:text-text-main"
                        )}
                      >
                        {label}
                        <div className={cn(
                          "w-2 h-2 rounded-full transition-colors",
                          settings.headerVisibility[key as keyof typeof settings.headerVisibility] ? "bg-surface-base" : "bg-transparent"
                        )} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="p-8 border-t border-border-subtle bg-surface-card backdrop-blur-xl">
            <button 
              onClick={() => setShowSettings(false)}
              className="w-full py-4 rounded-2xl font-bold shadow-lg transition-all bg-text-main text-surface-base hover:bg-text-main/90"
            >
              {t('settings_done')}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
