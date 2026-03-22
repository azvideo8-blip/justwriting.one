import React from 'react';
import { motion } from 'motion/react';
import { Pause, Square, Play, X, X as XIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface WritingEditorProps {
  status: 'idle' | 'writing' | 'paused' | 'finished';
  title: string;
  setTitle: (title: string) => void;
  content: string;
  setContent: (content: string) => void;
  fontSize: number;
  fontFamily: string;
  textWidth: 'centered' | 'full';
  handlePause: () => void;
  handleStart: () => void;
  handleFinish: () => void;
  setShowCancelConfirm: (show: boolean) => void;
  tags: string[];
  tagInput: string;
  setTagInput: (val: string) => void;
  addTag: () => void;
  removeTag: (tag: string) => void;
  isZenActive?: boolean;
  dynamicBgEnabled?: boolean;
  flowIndicatorEnabled?: boolean;
  wpm?: number;
}

export function WritingEditor({
  status,
  title,
  setTitle,
  content,
  setContent,
  fontSize,
  fontFamily,
  textWidth,
  handlePause,
  handleStart,
  handleFinish,
  setShowCancelConfirm,
  tags,
  tagInput,
  setTagInput,
  addTag,
  removeTag,
  isZenActive = false,
  dynamicBgEnabled = false,
  flowIndicatorEnabled = false,
  wpm = 0
}: WritingEditorProps) {
  // Calculate dynamic background color based on WPM
  // WPM 0 -> bg-white / bg-stone-900
  // WPM 60+ -> saturated warm color
  const getDynamicBgStyle = () => {
    if (!dynamicBgEnabled || status !== 'writing') return {};
    // Increase sensitivity: reach max intensity at 60 WPM instead of 80
    const intensity = Math.min(wpm / 60, 1); 
    const hue = 35; // Slightly more golden
    const saturation = intensity * 40; // Increased saturation from 20 to 40
    const lightness = 100 - (intensity * 10); // More significant lightness drop for light mode
    const darkLightness = 10 + (intensity * 10); // More significant lightness increase for dark mode
    
    return {
      '--dynamic-bg-light': `hsl(${hue}, ${saturation}%, ${lightness}%)`,
      '--dynamic-bg-dark': `hsl(${hue}, ${saturation}%, ${darkLightness}%)`,
    } as React.CSSProperties;
  };

  return (
    <div 
      style={getDynamicBgStyle()}
      className={cn(
        "max-w-7xl mx-auto px-4 md:px-8 space-y-6 transition-all duration-1000",
        textWidth === 'centered' ? "max-w-4xl" : "max-w-full"
      )}
    >
      <div className={cn(
        "flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-1000",
        isZenActive ? "opacity-0 pointer-events-none -translate-y-4" : "opacity-100 translate-y-0"
      )}>
        {status !== 'idle' && (
          <input 
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Заголовок (необязательно)..."
            className="w-full px-6 py-4 bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 shadow-sm focus:shadow-md outline-none text-xl font-bold dark:text-stone-100 transition-all"
            style={{ backgroundColor: dynamicBgEnabled ? 'var(--dynamic-bg-light, inherit)' : undefined }}
          />
        )}
        <div className="flex items-center gap-3">
          {status === 'writing' && (
            <>
              <button 
                onClick={handlePause}
                className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 px-4 md:px-6 py-3 rounded-xl font-semibold hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
              >
                <Pause size={18} fill="currentColor" />
                Пауза
              </button>
              <button 
                onClick={handleFinish}
                className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-4 md:px-6 py-3 rounded-xl font-semibold shadow-lg shadow-stone-200 dark:shadow-none hover:scale-105 transition-all"
              >
                <Square size={18} fill="currentColor" />
                Завершить
              </button>
            </>
          )}
          {status === 'paused' && (
            <>
              <button 
                onClick={handleStart}
                className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-4 md:px-6 py-3 rounded-xl font-semibold shadow-lg shadow-stone-200 dark:shadow-none hover:scale-105 transition-all"
              >
                <Play size={18} fill="currentColor" />
                Продолжить
              </button>
              <button 
                onClick={handleFinish}
                className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 px-4 md:px-6 py-3 rounded-xl font-semibold hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
              >
                <Square size={18} fill="currentColor" />
                Завершить
              </button>
            </>
          )}
          {(status === 'writing' || status === 'paused') && (
            <button 
              onClick={() => setShowCancelConfirm(true)}
              className="p-2 md:p-3 text-stone-400 hover:text-red-500 transition-colors shrink-0"
              title="Отменить сессию"
            >
              <X size={24} />
            </button>
          )}
        </div>
      </div>

      <div className="relative group">
        {status !== 'idle' && (
          <div className="h-4" />
        )}

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={status === 'idle' || status === 'paused'}
          placeholder={status === 'idle' ? "Нажмите 'Новая сессия', чтобы приступить к письму..." : "Пишите всё, что на уме..."}
          style={{ 
            fontSize: `${fontSize}px`,
            fontFamily: fontFamily === 'Inter' ? 'Inter, sans-serif' : 
                        fontFamily === 'Playfair Display' ? '"Playfair Display", serif' :
                        fontFamily === 'JetBrains Mono' ? '"JetBrains Mono", monospace' :
                        fontFamily === 'Cormorant Garamond' ? '"Cormorant Garamond", serif' :
                        fontFamily === 'Space Grotesk' ? '"Space Grotesk", sans-serif' : 'inherit',
            backgroundColor: dynamicBgEnabled ? 'var(--dynamic-bg-light, inherit)' : undefined
          }}
          className={cn(
            "w-full min-h-[400px] md:min-h-[500px] p-6 md:p-12 bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm focus:shadow-xl focus:border-stone-300 dark:focus:border-stone-700 transition-all outline-none leading-relaxed resize-none dark:text-stone-100",
            (status === 'idle' || status === 'paused') && "opacity-50 cursor-not-allowed",
            dynamicBgEnabled && "dark:!bg-[var(--dynamic-bg-dark)]"
          )}
        />

        {flowIndicatorEnabled && status === 'writing' && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none">
            <motion.div 
              initial={{ scaleX: 0 }}
              animate={{ 
                scaleX: Math.max(wpm / 40, 0.5), // More reactive scale
                opacity: Math.max(wpm / 15, 0.2),
                backgroundColor: wpm > 40 ? '#f59e0b' : '#1c1917' // Changes color when fast
              }}
              transition={{ duration: 0.5 }}
              className="w-48 h-1 rounded-full blur-[0.5px]"
            />
            <motion.div
              animate={{ 
                scale: [1, 1.2, 1],
                opacity: [0.3, 0.6, 0.3]
              }}
              transition={{ 
                duration: Math.max(2 - (wpm / 40), 0.5), // Faster pulse when writing fast
                repeat: Infinity 
              }}
              className="w-2 h-2 rounded-full bg-stone-900 dark:bg-stone-100"
            />
          </div>
        )}
      </div>

      {status !== 'idle' && (
        <div className={cn(
          "flex flex-wrap items-center gap-2 p-4 bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 transition-all duration-1000",
          isZenActive ? "opacity-0 pointer-events-none translate-y-4" : "opacity-100 translate-y-0"
        )}>
          <div className="flex flex-wrap gap-2">
            {tags.map(tag => (
              <span key={tag} className="flex items-center gap-1 px-2 py-1 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 rounded-lg text-xs font-medium">
                #{tag}
                <button onClick={() => removeTag(tag)} className="hover:text-red-500"><XIcon size={12} /></button>
              </span>
            ))}
          </div>
          <input 
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
            placeholder="Добавить тег..."
            className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm dark:text-stone-100"
          />
        </div>
      )}
    </div>
  );
}
