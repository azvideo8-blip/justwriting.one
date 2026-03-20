import React from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface WritingSettingsProps {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  fontFamily: string;
  setFontFamily: (font: string) => void;
  textWidth: 'centered' | 'full';
  setTextWidth: (width: 'centered' | 'full') => void;
  fontSize: number;
  setFontSize: (size: number) => void;
}

export function WritingSettings({ 
  showSettings, 
  setShowSettings, 
  fontFamily, 
  setFontFamily, 
  textWidth, 
  setTextWidth, 
  fontSize, 
  setFontSize 
}: WritingSettingsProps) {
  if (!showSettings) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-stone-900 p-8 rounded-3xl max-w-md w-full space-y-8 shadow-2xl border border-stone-200 dark:border-stone-800 max-h-[90vh] overflow-y-auto no-scrollbar"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold">Настройки</h3>
          <button 
            onClick={() => setShowSettings(false)}
            className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">Шрифт</label>
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
            <label className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">Ширина текста</label>
            <div className="flex bg-stone-50 dark:bg-stone-800 p-1 rounded-xl">
              <button 
                onClick={() => setTextWidth('centered')}
                className={cn(
                  "flex-1 py-3 rounded-lg font-bold text-sm transition-all",
                  textWidth === 'centered' ? "bg-white dark:bg-stone-900 shadow-sm" : "text-stone-500"
                )}
              >
                По центру
              </button>
              <button 
                onClick={() => setTextWidth('full')}
                className={cn(
                  "flex-1 py-3 rounded-lg font-bold text-sm transition-all",
                  textWidth === 'full' ? "bg-white dark:bg-stone-900 shadow-sm" : "text-stone-500"
                )}
              >
                На всю ширину
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">Размер шрифта: {fontSize}px</label>
            <input 
              type="range"
              min="14"
              max="32"
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="w-full h-2 bg-stone-100 dark:bg-stone-800 rounded-lg appearance-none cursor-pointer accent-stone-900 dark:accent-stone-100"
            />
          </div>
        </div>

        <button 
          onClick={() => setShowSettings(false)}
          className="w-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 py-4 rounded-xl font-bold shadow-lg"
        >
          Готово
        </button>
      </motion.div>
    </div>
  );
}
