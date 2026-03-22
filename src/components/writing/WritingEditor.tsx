import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Pause, Square, Play, X, X as XIcon, Pin, PinOff } from 'lucide-react';
import { cn } from '../../lib/utils';

interface WritingEditorProps {
  status: 'idle' | 'writing' | 'paused' | 'finished';
  title: string;
  setTitle: (title: string) => void;
  pinnedThought: string;
  setPinnedThought: (thought: string) => void;
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
  wpm?: number;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
}

export function WritingEditor({
  status,
  title,
  setTitle,
  pinnedThought,
  setPinnedThought,
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
  wpm = 0,
  saveStatus,
  lastSavedAt
}: WritingEditorProps) {
  const [showPinnedInput, setShowPinnedInput] = React.useState(false);
  const [hasSelection, setHasSelection] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Check for text selection
  const checkSelection = () => {
    if (textareaRef.current) {
      const start = textareaRef.current.selectionStart;
      const end = textareaRef.current.selectionEnd;
      setHasSelection(start !== end);
    }
  };

  const handlePinSelection = () => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const selectedText = content.substring(start, end).trim();
    
    if (selectedText) {
      setPinnedThought(selectedText);
      setShowPinnedInput(true);
      // Clear selection after pinning
      textareaRef.current.setSelectionRange(end, end);
      setHasSelection(false);
    } else {
      setShowPinnedInput(!showPinnedInput);
    }
  };

  // Keyboard shortcut Alt+P to pin selection
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handlePinSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [content, pinnedThought, showPinnedInput]);

  return (
    <div 
      className={cn(
        "max-w-7xl mx-auto px-4 md:px-8 space-y-6 transition-all duration-1000",
        textWidth === 'centered' ? "max-w-4xl" : "max-w-full"
      )}
    >
      <div className={cn(
        "flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-1000 sticky top-0 z-20 py-4 bg-inherit",
        isZenActive && !pinnedThought ? "opacity-0 pointer-events-none -translate-y-4" : "opacity-100 translate-y-0"
      )}>
        {status !== 'idle' && (
          <div className="flex-1 flex flex-col gap-2">
            <div className="relative flex items-center gap-2">
              <input 
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Заголовок (необязательно)..."
                className="w-full px-6 py-4 rounded-2xl border border-stone-200 dark:border-stone-800 shadow-sm focus:shadow-md outline-none text-xl font-bold dark:text-stone-100 transition-all"
                style={{ 
                  backgroundColor: dynamicBgEnabled ? 'var(--dynamic-bg)' : undefined,
                  background: dynamicBgEnabled ? undefined : undefined // Fallback handled by classes if needed
                }}
              />
              <button 
                onClick={handlePinSelection}
                className={cn(
                  "p-3 rounded-xl border transition-all shrink-0 flex items-center gap-2",
                  (pinnedThought || showPinnedInput || hasSelection)
                    ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 border-stone-900 dark:border-stone-100" 
                    : "bg-white dark:bg-stone-900 text-stone-400 border-stone-200 dark:border-stone-800 hover:border-stone-400"
                )}
                title={hasSelection ? "Закрепить выделенное (Alt+P)" : "Закрепить мысль"}
              >
                <Pin size={20} className={cn(hasSelection && "animate-pulse")} />
                {hasSelection && <span className="text-[10px] font-bold uppercase tracking-tighter hidden sm:inline">Закрепить</span>}
              </button>
            </div>

            <AnimatePresence>
              {(showPinnedInput || pinnedThought) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="relative group/pinned">
                    <textarea
                      value={pinnedThought}
                      onChange={(e) => setPinnedThought(e.target.value)}
                      placeholder="Закрепленная мысль или цитата..."
                      rows={2}
                      className="w-full px-6 py-3 bg-stone-50 dark:bg-stone-950/50 border-2 border-dashed border-stone-200 dark:border-stone-800 rounded-2xl outline-none text-sm italic text-stone-600 dark:text-stone-400 resize-none transition-all focus:border-stone-400 dark:focus:border-stone-600"
                    />
                    {pinnedThought && (
                      <button 
                        onClick={() => {
                          setPinnedThought('');
                          setShowPinnedInput(false);
                        }}
                        className="absolute top-2 right-2 p-1 text-stone-400 hover:text-red-500 opacity-0 group-hover/pinned:opacity-100 transition-opacity"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
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
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            checkSelection();
          }}
          onSelect={checkSelection}
          onKeyUp={checkSelection}
          onMouseUp={checkSelection}
          disabled={status === 'idle' || status === 'paused'}
          placeholder={status === 'idle' ? "Нажмите 'Новая сессия', чтобы приступить к письму..." : "Пишите всё, что на уме..."}
          style={{ 
            fontSize: `${fontSize}px`,
            fontFamily: fontFamily === 'Inter' ? 'Inter, sans-serif' : 
                        fontFamily === 'Playfair Display' ? '"Playfair Display", serif' :
                        fontFamily === 'JetBrains Mono' ? '"JetBrains Mono", monospace' :
                        fontFamily === 'Cormorant Garamond' ? '"Cormorant Garamond", serif' :
                        fontFamily === 'Space Grotesk' ? '"Space Grotesk", sans-serif' : 'inherit',
            backgroundColor: dynamicBgEnabled ? 'var(--dynamic-bg)' : undefined
          }}
          className={cn(
            "w-full min-h-[400px] md:min-h-[500px] p-6 md:p-12 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm focus:shadow-xl focus:border-stone-300 dark:focus:border-stone-700 transition-all outline-none leading-relaxed resize-none dark:text-stone-100",
            !dynamicBgEnabled ? "bg-white dark:bg-stone-900" : "bg-transparent",
            (status === 'idle' || status === 'paused') && "opacity-50 cursor-not-allowed",
            dynamicBgEnabled && "dark:!bg-[var(--dynamic-bg-dark)]"
          )}
        />

        {/* Save Status Indicator */}
        {status !== 'idle' && (
          <div className={cn(
            "absolute top-4 right-6 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-all duration-500 pointer-events-none z-10",
            isZenActive && saveStatus === 'idle' ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0",
            saveStatus === 'saving' ? "text-amber-500 animate-pulse" :
            saveStatus === 'saved' ? "text-emerald-500" :
            saveStatus === 'error' ? "text-red-500" : "text-stone-400"
          )}>
            <div className={cn(
              "w-1.5 h-1.5 rounded-full",
              saveStatus === 'saving' ? "bg-amber-500" :
              saveStatus === 'saved' ? "bg-emerald-500" :
              saveStatus === 'error' ? "bg-red-500" : "bg-stone-300"
            )} />
            {saveStatus === 'saving' && "Сохранение..."}
            {saveStatus === 'saved' && "Сохранено"}
            {saveStatus === 'error' && "Ошибка сохранения"}
            {saveStatus === 'idle' && lastSavedAt && `Сохранено ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
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
