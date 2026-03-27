import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Type, Maximize2, Moon, Palette, Pin, Eye, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../lib/i18n';
import { useUI } from '../../contexts/UIContext';

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
  // dynamicBgEnabled: boolean;
  // setDynamicBgEnabled: (enabled: boolean) => void;
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
  // dynamicBgEnabled,
  // setDynamicBgEnabled,
  stickyHeaderEnabled,
  setStickyHeaderEnabled,
  headerVisibility,
  setHeaderVisibility
}: WritingSettingsProps) {
  const { t } = useLanguage();
  const { uiVersion, streamMode, toggleStreamMode } = useUI();
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
      <div className={cn("fixed inset-0 z-[60] flex items-center justify-center p-4", isV2 ? "bg-[#0A0A0B]/80 backdrop-blur-2xl" : "bg-stone-900/60 backdrop-blur-md")}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className={cn(
            "w-full max-w-lg rounded-[2.5rem] overflow-hidden flex flex-col max-h-[90vh]",
            isV2 
              ? "bg-[#0A0A0B]/80 backdrop-blur-2xl border border-white/10 shadow-[0_0_40px_rgba(255,255,255,0.05)] text-[#E5E5E0]" 
              : "bg-white dark:bg-stone-900 shadow-2xl border border-stone-200 dark:border-stone-800"
          )}
        >
          <div className={cn("p-6 md:p-8 border-b flex items-center justify-between sticky top-0 z-10", isV2 ? "border-white/10 bg-[#0A0A0B]/80 backdrop-blur-xl" : "border-stone-100 dark:border-stone-800 bg-white/80 dark:bg-stone-900/80 backdrop-blur-md")}>
            <h3 className={cn("text-xl md:text-2xl font-black tracking-tight", isV2 ? "text-white" : "dark:text-stone-100")}>{t('settings_title')}</h3>
            <button 
              onClick={() => setShowSettings(false)}
              className={cn("p-2 rounded-full transition-colors", isV2 ? "hover:bg-white/10 text-white/50 hover:text-white" : "hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100")}
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-6 md:p-8 overflow-y-auto no-scrollbar space-y-8 md:space-y-10">
            {/* Typography */}
            <div className="space-y-4 md:space-y-6">
              <div className="flex items-center gap-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", isV2 ? "bg-white/10 text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100")}>
                  <Type size={16} />
                </div>
                <h4 className={cn("font-bold text-sm md:text-base uppercase tracking-wider", isV2 ? "text-white/50" : "text-stone-400")}>{t('settings_font')}</h4>
              </div>
              
              <div className="space-y-4">
                <div>
                  <div className="grid grid-cols-2 gap-2 md:gap-3">
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
                          "py-2 md:py-3 px-4 rounded-xl md:rounded-2xl text-sm md:text-base transition-all",
                          font.class,
                          fontFamily === font.id 
                            ? (isV2 ? "bg-white text-black font-bold shadow-[0_0_20px_rgba(255,255,255,0.2)]" : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 font-bold")
                            : (isV2 ? "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white" : "bg-stone-50 dark:bg-stone-800/50 text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800")
                        )}
                      >
                        {font.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2 md:mb-3">
                    <label className={cn("text-xs font-bold uppercase tracking-wider", isV2 ? "text-white/50" : "text-stone-500 dark:text-stone-400")}>{t('settings_font_size')}</label>
                    <span className={cn("text-xs font-bold", isV2 ? "text-white" : "text-stone-900 dark:text-stone-100")}>{fontSize}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="14" 
                    max="32" 
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className={cn("w-full accent-current", isV2 ? "text-white" : "text-stone-900 dark:text-stone-100")}
                  />
                </div>
              </div>
            </div>

            {/* Layout */}
            <div className="space-y-4 md:space-y-6">
              <div className="flex items-center gap-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", isV2 ? "bg-white/10 text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100")}>
                  <Maximize2 size={16} />
                </div>
                <h4 className={cn("font-bold text-sm md:text-base uppercase tracking-wider", isV2 ? "text-white/50" : "text-stone-400")}>{t('settings_width')}</h4>
              </div>

              <div>
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  {[
                    { id: 'centered', label: t('settings_width_centered') },
                    { id: 'full', label: t('settings_width_full') }
                  ].map(width => (
                    <button
                      key={width.id}
                      onClick={() => setTextWidth(width.id as 'centered' | 'full')}
                      className={cn(
                        "py-2 md:py-3 px-2 rounded-xl md:rounded-2xl text-xs md:text-sm transition-all font-bold",
                        textWidth === width.id 
                          ? (isV2 ? "bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.2)]" : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900")
                          : (isV2 ? "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white" : "bg-stone-50 dark:bg-stone-800/50 text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800")
                      )}
                    >
                      {width.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Experience */}
            <div className="space-y-4 md:space-y-6">
              <div className="flex items-center gap-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", isV2 ? "bg-white/10 text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100")}>
                  <Palette size={16} />
                </div>
                <h4 className={cn("font-bold text-sm md:text-base uppercase tracking-wider", isV2 ? "text-white/50" : "text-stone-400")}>{t('settings_zen')}</h4>
              </div>

              <div className="space-y-2 md:space-y-3">
                <div 
                  onClick={() => setZenModeEnabled(!zenModeEnabled)}
                  className={cn(
                    "p-3 md:p-4 rounded-xl md:rounded-2xl flex items-center justify-between cursor-pointer transition-colors",
                    isV2 ? "bg-white/5 hover:bg-white/10" : "bg-stone-50 dark:bg-stone-800/50 hover:bg-stone-100 dark:hover:bg-stone-800"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Moon size={18} className={isV2 ? "text-white/50" : "text-stone-400"} />
                    <div>
                      <div className={cn("font-bold text-sm md:text-base", isV2 ? "text-white" : "dark:text-stone-100")}>{t('settings_zen')}</div>
                      <div className={cn("text-[10px] md:text-xs", isV2 ? "text-white/50" : "text-stone-500 dark:text-stone-400")}>{t('settings_zen_desc')}</div>
                    </div>
                  </div>
                  <div className={cn(
                    "w-10 h-5 md:w-12 md:h-6 rounded-full transition-all duration-500 relative shrink-0", 
                    zenModeEnabled ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]" : (isV2 ? "bg-white/20" : "bg-stone-300 dark:bg-stone-700")
                  )}>
                    <div className={cn(
                      "absolute top-0.5 left-0.5 md:top-1 md:left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-500", 
                      zenModeEnabled ? "translate-x-5 md:translate-x-6" : "translate-x-0"
                    )} />
                  </div>
                </div>

                {/* <div 
                  onClick={() => setDynamicBgEnabled(!dynamicBgEnabled)}
                  className={cn(
                    "p-3 md:p-4 rounded-xl md:rounded-2xl flex items-center justify-between cursor-pointer transition-colors",
                    isV2 ? "bg-white/5 hover:bg-white/10" : "bg-stone-50 dark:bg-stone-800/50 hover:bg-stone-100 dark:hover:bg-stone-800"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Palette size={18} className={isV2 ? "text-white/50" : "text-stone-400"} />
                    <div>
                      <div className={cn("font-bold text-sm md:text-base", isV2 ? "text-white" : "dark:text-stone-100")}>{t('settings_dynamic_bg')}</div>
                      <div className={cn("text-[10px] md:text-xs", isV2 ? "text-white/50" : "text-stone-500 dark:text-stone-400")}>{t('settings_dynamic_bg_desc')}</div>
                    </div>
                  </div>
                  <div className={cn(
                    "w-10 h-5 md:w-12 md:h-6 rounded-full transition-all duration-500 relative shrink-0", 
                    dynamicBgEnabled ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]" : (isV2 ? "bg-white/20" : "bg-stone-300 dark:bg-stone-700")
                  )}>
                    <div className={cn(
                      "absolute top-0.5 left-0.5 md:top-1 md:left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-500", 
                      dynamicBgEnabled ? "translate-x-5 md:translate-x-6" : "translate-x-0"
                    )} />
                  </div>
                </div> */}

                <div 
                  onClick={toggleStreamMode}
                  className={cn(
                    "p-3 md:p-4 rounded-xl md:rounded-2xl flex items-center justify-between cursor-pointer transition-colors",
                    isV2 ? "bg-white/5 hover:bg-white/10" : "bg-stone-50 dark:bg-stone-800/50 hover:bg-stone-100 dark:hover:bg-stone-800"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Zap size={18} className={isV2 ? "text-white/50" : "text-stone-400"} />
                    <div>
                      <div className={cn("font-bold text-sm md:text-base", isV2 ? "text-white" : "dark:text-stone-100")}>{t('settings_stream_mode')}</div>
                      <div className={cn("text-[10px] md:text-xs", isV2 ? "text-white/50" : "text-stone-500 dark:text-stone-400")}>{t('settings_stream_mode_desc')}</div>
                    </div>
                  </div>
                  <div className={cn(
                    "w-10 h-5 md:w-12 md:h-6 rounded-full transition-all duration-500 relative shrink-0", 
                    streamMode ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]" : (isV2 ? "bg-white/20" : "bg-stone-300 dark:bg-stone-700")
                  )}>
                    <div className={cn(
                      "absolute top-0.5 left-0.5 md:top-1 md:left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-500", 
                      streamMode ? "translate-x-5 md:translate-x-6" : "translate-x-0"
                    )} />
                  </div>
                </div>
              </div>
            </div>

            {/* Header Configuration */}
            <div className="space-y-4 md:space-y-6">
              <div className="flex items-center gap-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", isV2 ? "bg-white/10 text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100")}>
                  <Pin size={16} />
                </div>
                <h4 className={cn("font-bold text-sm md:text-base uppercase tracking-wider", isV2 ? "text-white/50" : "text-stone-400")}>{t('settings_sticky')}</h4>
              </div>

              <div className="space-y-2 md:space-y-3">
                <div 
                  onClick={() => setStickyHeaderEnabled(!stickyHeaderEnabled)}
                  className={cn(
                    "p-3 md:p-4 rounded-xl md:rounded-2xl flex items-center justify-between cursor-pointer transition-colors",
                    isV2 ? "bg-white/5 hover:bg-white/10" : "bg-stone-50 dark:bg-stone-800/50 hover:bg-stone-100 dark:hover:bg-stone-800"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Pin size={18} className={isV2 ? "text-white/50" : "text-stone-400"} />
                    <div>
                      <div className={cn("font-bold text-sm md:text-base", isV2 ? "text-white" : "dark:text-stone-100")}>{t('settings_sticky')}</div>
                      <div className={cn("text-[10px] md:text-xs", isV2 ? "text-white/50" : "text-stone-500 dark:text-stone-400")}>{t('settings_sticky_desc')}</div>
                    </div>
                  </div>
                  <div className={cn(
                    "w-10 h-5 md:w-12 md:h-6 rounded-full transition-all duration-500 relative shrink-0", 
                    stickyHeaderEnabled ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]" : (isV2 ? "bg-white/20" : "bg-stone-300 dark:bg-stone-700")
                  )}>
                    <div className={cn(
                      "absolute top-0.5 left-0.5 md:top-1 md:left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-500", 
                      stickyHeaderEnabled ? "translate-x-5 md:translate-x-6" : "translate-x-0"
                    )} />
                  </div>
                </div>

                <div className={cn("p-4 md:p-5 rounded-xl md:rounded-2xl space-y-3 md:space-y-4", isV2 ? "bg-white/5" : "bg-stone-50 dark:bg-stone-800/50")}>
                  <div className="flex items-center gap-2 mb-2">
                    <Eye size={14} className={isV2 ? "text-white/50" : "text-stone-400"} />
                    <span className={cn("text-xs font-bold uppercase tracking-wider", isV2 ? "text-white/50" : "text-stone-500 dark:text-stone-400")}>{t('settings_elements')}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:gap-3">
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
                          "py-2 px-3 rounded-lg md:rounded-xl text-xs md:text-sm font-bold transition-all flex items-center justify-between",
                          headerVisibility[key as keyof typeof headerVisibility]
                            ? (isV2 ? "bg-white/20 text-white shadow-[0_0_15px_rgba(255,255,255,0.1)]" : "bg-stone-200 dark:bg-stone-700 text-stone-900 dark:text-stone-100")
                            : (isV2 ? "bg-white/5 text-white/30 hover:bg-white/10 hover:text-white/70" : "bg-stone-100 dark:bg-stone-800 text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700")
                        )}
                      >
                        {label}
                        <div className={cn(
                          "w-2 h-2 rounded-full transition-colors",
                          headerVisibility[key as keyof typeof headerVisibility] ? "bg-emerald-500" : "bg-transparent"
                        )} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className={cn("p-6 md:p-8 border-t", isV2 ? "border-white/10 bg-[#0A0A0B]/80 backdrop-blur-xl" : "border-stone-100 dark:border-stone-800 bg-white/80 dark:bg-stone-900/80 backdrop-blur-md")}>
            <button 
              onClick={() => setShowSettings(false)}
              className={cn(
                "w-full py-4 rounded-xl font-bold shadow-lg transition-all",
                isV2 ? "bg-white text-black hover:bg-white/90" : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900"
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
