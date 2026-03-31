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
  setShowSettings, 
  fontFamily, 
  setFontFamily, 
  fontSize, 
  setFontSize,
  stickyHeaderEnabled,
  setStickyHeaderEnabled,
  headerVisibility,
  setHeaderVisibility
}: WritingSettingsProps) {
  const { t } = useLanguage();
  const { uiVersion } = useUI();
  const { streamMode, toggleStreamMode, zenModeEnabled, setZenModeEnabled, textWidth, setTextWidth } = useWritingSettings();
  const isV2 = uiVersion === '2.0';

  if (!showSettings) return null;

  const toggleVisibility = (key: keyof typeof headerVisibility) => {
    setHeaderVisibility({
      ...headerVisibility,
      [key]: !headerVisibility[key]
    });
  };

  return (
    <AnimatePresence>
      <div className={cn("fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-2xl")}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className={cn(
            "w-full max-w-lg rounded-[2.5rem] overflow-hidden flex flex-col max-h-[90vh] bg-stone-900/40 backdrop-blur-2xl border border-white/10 text-[#E5E5E0]"
          )}
        >
          <div className={cn("p-6 md:p-8 border-b border-white/10 flex items-center justify-between sticky top-0 z-10 bg-stone-900/40 backdrop-blur-xl")}>
            <h3 className={cn("text-xl md:text-2xl font-black tracking-tight text-white")}>{t('settings_title')}</h3>
            <button 
              onClick={() => setShowSettings(false)}
              className={cn("p-2 rounded-full transition-colors hover:bg-white/10 text-white/50 hover:text-white")}
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-6 md:p-8 overflow-y-auto no-scrollbar space-y-8 md:space-y-10">
            {/* Typography */}
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center bg-white/10 text-white")}>
                  <Type size={16} />
                </div>
                <h4 className={cn("font-bold text-[11px] uppercase tracking-[0.2em] text-white/50")}>{t('settings_font')}</h4>
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
                        onClick={() => setFontFamily(font.id)}
                        className={cn(
                          "py-3 px-4 rounded-2xl text-base transition-all border font-bold",
                          font.class,
                          fontFamily === font.id 
                            ? "bg-white text-black border-white"
                            : "bg-transparent border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        {font.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className={cn("text-[11px] uppercase tracking-[0.2em] text-white/50")}>{t('settings_font_size')}</label>
                    <span className={cn("text-xs font-bold text-white")}>{fontSize}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="14" 
                    max="32" 
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className={cn("w-full h-1 bg-white/20 rounded-full appearance-none accent-white")}
                  />
                </div>
              </div>
            </div>

            {/* Layout */}
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center bg-white/10 text-white")}>
                  <Maximize2 size={16} />
                </div>
                <h4 className={cn("font-bold text-[11px] uppercase tracking-[0.2em] text-white/50")}>{t('settings_width')}</h4>
              </div>

              <div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'centered', label: t('settings_width_centered') },
                    { id: 'full', label: t('settings_width_full') }
                  ].map(width => (
                    <button
                      key={width.id}
                      onClick={() => setTextWidth(width.id as 'centered' | 'full')}
                      className={cn(
                        "py-3 px-4 rounded-2xl text-sm transition-all font-bold border",
                        textWidth === width.id 
                          ? "bg-white text-black border-white"
                          : "bg-transparent border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
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
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center bg-white/10 text-white")}>
                  <Palette size={16} />
                </div>
                <h4 className={cn("font-bold text-[11px] uppercase tracking-[0.2em] text-white/50")}>{t('settings_zen')}</h4>
              </div>

              <div className="space-y-3">
                <div 
                  onClick={() => setZenModeEnabled(!zenModeEnabled)}
                  className={cn(
                    "p-4 rounded-2xl flex items-center justify-between cursor-pointer transition-all border",
                    zenModeEnabled ? "bg-white border-white" : "bg-transparent border-white/10 hover:bg-white/10"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Moon size={18} className={zenModeEnabled ? "text-black" : "text-white/50"} />
                    <div>
                      <div className={cn("font-bold text-base", zenModeEnabled ? "text-black" : "text-white")}>{t('settings_zen')}</div>
                      <div className={cn("text-[10px] uppercase tracking-[0.2em]", zenModeEnabled ? "text-black/50" : "text-white/50")}>{t('settings_zen_desc')}</div>
                    </div>
                  </div>
                  <div className={cn(
                    "w-12 h-6 rounded-full transition-all duration-500 relative shrink-0", 
                    zenModeEnabled ? "bg-black" : "bg-white/10"
                  )}>
                    <div className={cn(
                      "absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-500", 
                      zenModeEnabled ? "translate-x-6" : "translate-x-0"
                    )} />
                  </div>
                </div>

                <div 
                  onClick={toggleStreamMode}
                  className={cn(
                    "p-4 rounded-2xl flex items-center justify-between cursor-pointer transition-all border",
                    streamMode ? "bg-white border-white" : "bg-transparent border-white/10 hover:bg-white/10"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Zap size={18} className={streamMode ? "text-black" : "text-white/50"} />
                    <div>
                      <div className={cn("font-bold text-base", streamMode ? "text-black" : "text-white")}>{t('settings_stream_mode')}</div>
                      <div className={cn("text-[10px] uppercase tracking-[0.2em]", streamMode ? "text-black/50" : "text-white/50")}>{t('settings_stream_mode_desc')}</div>
                    </div>
                  </div>
                  <div className={cn(
                    "w-12 h-6 rounded-full transition-all duration-500 relative shrink-0", 
                    streamMode ? "bg-black" : "bg-white/10"
                  )}>
                    <div className={cn(
                      "absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-500", 
                      streamMode ? "translate-x-6" : "translate-x-0"
                    )} />
                  </div>
                </div>
              </div>
            </div>

            {/* Header Configuration */}
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center bg-white/10 text-white")}>
                  <Pin size={16} />
                </div>
                <h4 className={cn("font-bold text-[11px] uppercase tracking-[0.2em] text-white/50")}>{t('settings_sticky')}</h4>
              </div>

              <div className="space-y-3">
                <div 
                  onClick={() => setStickyHeaderEnabled(!stickyHeaderEnabled)}
                  className={cn(
                    "p-4 rounded-2xl flex items-center justify-between cursor-pointer transition-all border",
                    stickyHeaderEnabled ? "bg-white border-white" : "bg-transparent border-white/10 hover:bg-white/10"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Pin size={18} className={stickyHeaderEnabled ? "text-black" : "text-white/50"} />
                    <div>
                      <div className={cn("font-bold text-base", stickyHeaderEnabled ? "text-black" : "text-white")}>{t('settings_sticky')}</div>
                      <div className={cn("text-[10px] uppercase tracking-[0.2em]", stickyHeaderEnabled ? "text-black/50" : "text-white/50")}>{t('settings_sticky_desc')}</div>
                    </div>
                  </div>
                  <div className={cn(
                    "w-12 h-6 rounded-full transition-all duration-500 relative shrink-0", 
                    stickyHeaderEnabled ? "bg-black" : "bg-white/10"
                  )}>
                    <div className={cn(
                      "absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-500", 
                      stickyHeaderEnabled ? "translate-x-6" : "translate-x-0"
                    )} />
                  </div>
                </div>

                <div className={cn("p-5 rounded-2xl space-y-4 bg-white/5 border border-white/10")}>
                  <div className="flex items-center gap-2 mb-2">
                    <Eye size={14} className="text-white/50" />
                    <span className={cn("text-[10px] uppercase tracking-[0.2em] text-white/50")}>{t('settings_elements')}</span>
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
                        onClick={() => toggleVisibility(key as any)}
                        className={cn(
                          "py-3 px-4 rounded-xl text-sm font-bold transition-all flex items-center justify-between border",
                          headerVisibility[key as keyof typeof headerVisibility]
                            ? "bg-white text-black border-white"
                            : "bg-transparent border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        {label}
                        <div className={cn(
                          "w-2 h-2 rounded-full transition-colors",
                          headerVisibility[key as keyof typeof headerVisibility] ? "bg-black" : "bg-transparent"
                        )} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className={cn("p-8 border-t border-white/10 bg-stone-900/40 backdrop-blur-xl")}>
            <button 
              onClick={() => setShowSettings(false)}
              className={cn(
                "w-full py-4 rounded-2xl font-bold shadow-lg transition-all bg-white text-black hover:bg-white/90"
              )}
            >
              {t('settings_done')}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
