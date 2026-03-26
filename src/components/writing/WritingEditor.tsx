import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Pause, Square, Play, X, X as XIcon, Pin, PinOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../lib/i18n';
import { useUI } from '../../contexts/UIContext';

interface WritingEditorProps {
  status: 'idle' | 'writing' | 'paused' | 'finished';
  title: string;
  setTitle: (title: string) => void;
  pinnedThoughts: string[];
  setPinnedThoughts: (thoughts: string[]) => void;
  content: string;
  setContent: (content: string) => void;
  fontSize: number;
  fontFamily: string;
  textWidth: 'centered' | 'full';
  handlePause: () => void;
  handleStart: () => void;
  handleFinish: () => void;
  setShowCancelConfirm: (show: boolean) => void;
  isZenActive?: boolean;
  dynamicBgEnabled?: boolean;
  wpm?: number;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  stickyHeaderEnabled?: boolean;
}

export function WritingEditor({
  status,
  title,
  setTitle,
  pinnedThoughts,
  setPinnedThoughts,
  content,
  setContent,
  fontSize,
  fontFamily,
  textWidth,
  handlePause,
  handleStart,
  handleFinish,
  setShowCancelConfirm,
  isZenActive = false,
  dynamicBgEnabled = false,
  wpm = 0,
  saveStatus,
  lastSavedAt,
  stickyHeaderEnabled = true
}: WritingEditorProps) {
  const { t } = useLanguage();
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';
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
      setPinnedThoughts([...pinnedThoughts, selectedText]);
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
  }, [content, pinnedThoughts, showPinnedInput]);

  // Typewriter mode: scroll textarea to center caret
  React.useLayoutEffect(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      const text = textarea.value;
      const selectionStart = textarea.selectionStart;
      
      const mirror = document.createElement('div');
      mirror.style.position = 'absolute';
      mirror.style.visibility = 'hidden';
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.wordWrap = 'break-word';
      mirror.style.width = textarea.clientWidth + 'px';
      mirror.style.font = window.getComputedStyle(textarea).font;
      mirror.style.padding = window.getComputedStyle(textarea).padding;
      mirror.style.fontSize = window.getComputedStyle(textarea).fontSize;
      mirror.style.lineHeight = window.getComputedStyle(textarea).lineHeight;
      
      mirror.textContent = text.substring(0, selectionStart);
      
      const span = document.createElement('span');
      span.textContent = text.substring(selectionStart) || '.';
      mirror.appendChild(span);
      
      document.body.appendChild(mirror);
      
      const { offsetTop } = span;
      document.body.removeChild(mirror);
      
      textarea.scrollTop = offsetTop - textarea.clientHeight / 2 + 50;
    }
  }, [content]);

  return (
    <div 
      className={cn(
        "mx-auto px-4 md:px-8 space-y-6 transition-all duration-1000 py-8",
        textWidth === 'centered' ? "max-w-4xl" : "max-w-full",
        isV2 && "font-serif"
      )}
    >
      {isV2 && (
        <motion.div
          className="fixed inset-0 z-0 pointer-events-none"
          animate={{
            background: [
              "radial-gradient(circle at 50% 50%, #1a1a1a 0%, #0a0a0b 100%)",
              "radial-gradient(circle at 40% 60%, #2a2a2a 0%, #0a0a0b 100%)",
              "radial-gradient(circle at 60% 40%, #1a1a1a 0%, #0a0a0b 100%)",
            ]
          }}
          transition={{ duration: 10, repeat: Infinity, repeatType: "reverse" }}
        />
      )}
      <div className={cn(
        "flex flex-col gap-4 transition-all duration-1000 z-30 py-2",
        stickyHeaderEnabled ? "sticky top-[128px] md:top-[120px]" : "relative",
        isZenActive && pinnedThoughts.length === 0 ? "opacity-0 pointer-events-none -translate-y-4" : "opacity-100 translate-y-0"
      )}>
        {status !== 'idle' && (
          <div className="flex-1 flex flex-col gap-2">
            <div className="relative flex items-center gap-3">
              <input 
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('editor_title_placeholder')}
                className={cn(
                  "w-full px-6 py-4 rounded-2xl border border-stone-200 dark:border-stone-800 shadow-sm focus:shadow-xl outline-none text-xl font-black dark:text-stone-100 transition-all",
                  dynamicBgEnabled && status === 'writing' ? "bg-[var(--dynamic-bg)]/50 dark:bg-[var(--dynamic-bg-dark)]/50 backdrop-blur-md" : "bg-white dark:bg-stone-900"
                )}
              />
              <button 
                onClick={handlePinSelection}
                className={cn(
                  "p-4 rounded-2xl border transition-all shrink-0 flex items-center justify-center shadow-sm",
                  (pinnedThoughts.length > 0 || showPinnedInput || hasSelection)
                    ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 border-stone-900 dark:border-stone-100" 
                    : "bg-white dark:bg-stone-900 text-stone-400 border-stone-200 dark:border-stone-800 hover:border-stone-400"
                )}
                title={hasSelection ? `${t('editor_pin_thought')} (Alt+P)` : t('editor_pin_thought')}
              >
                <Pin size={20} className={cn(hasSelection && "animate-pulse")} />
              </button>
            </div>

            <AnimatePresence>
              {(showPinnedInput || pinnedThoughts.length > 0) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="relative group/pinned space-y-2">
                    {pinnedThoughts.map((thought, index) => (
                      <div key={index} className="relative">
                        <textarea
                          value={thought}
                          onChange={(e) => {
                            const newThoughts = [...pinnedThoughts];
                            newThoughts[index] = e.target.value;
                            setPinnedThoughts(newThoughts);
                          }}
                          placeholder={t('editor_pinned_placeholder')}
                          rows={1}
                          className="w-full px-6 py-3 bg-stone-50/50 dark:bg-stone-950/30 border-2 border-dashed border-stone-200 dark:border-stone-800 rounded-2xl outline-none text-sm italic font-serif text-stone-600 dark:text-stone-400 resize-none transition-all focus:border-stone-400 dark:focus:border-stone-600"
                        />
                        <button 
                          onClick={() => {
                            setPinnedThoughts(pinnedThoughts.filter((_, i) => i !== index));
                          }}
                          className="absolute top-2 right-2 p-1.5 text-stone-400 hover:text-red-500 opacity-0 group-hover/pinned:opacity-100 transition-opacity"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    {showPinnedInput && (
                      <textarea
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            setPinnedThoughts([...pinnedThoughts, e.target.value]);
                            setShowPinnedInput(false);
                          }
                        }}
                        placeholder={t('editor_add_thought')}
                        rows={1}
                        className="w-full px-6 py-3 bg-stone-50/50 dark:bg-stone-950/30 border-2 border-dashed border-stone-200 dark:border-stone-800 rounded-2xl outline-none text-sm italic font-serif text-stone-600 dark:text-stone-400 resize-none transition-all focus:border-stone-400 dark:focus:border-stone-600"
                      />
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="relative group">
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
          placeholder={status === 'idle' ? t('editor_idle_placeholder') : t('editor_writing_placeholder')}
          style={{ 
            fontSize: `${isV2 ? fontSize * 1.5 : fontSize}px`,
            fontFamily: fontFamily === 'Inter' ? 'Inter, sans-serif' : 
                        fontFamily === 'Playfair Display' ? '"Playfair Display", serif' :
                        fontFamily === 'JetBrains Mono' ? '"JetBrains Mono", monospace' :
                        fontFamily === 'Cormorant Garamond' ? '"Cormorant Garamond", serif' :
                        fontFamily === 'Space Grotesk' ? '"Space Grotesk", sans-serif' : 'inherit',
            backgroundColor: dynamicBgEnabled ? 'var(--dynamic-bg)' : undefined
          }}
          className={cn(
            "w-full min-h-[500px] md:min-h-[600px] p-8 md:p-12 rounded-[2.5rem] border border-stone-200 dark:border-stone-800 shadow-xl focus:shadow-2xl focus:border-stone-300 dark:focus:border-stone-700 transition-all outline-none resize-none dark:text-stone-100",
            isV2 ? "leading-[1.8] bg-transparent border-none shadow-none" : "leading-relaxed",
            !dynamicBgEnabled && !isV2 ? "bg-white dark:bg-stone-900" : "bg-transparent",
            (status === 'idle' || status === 'paused') && "opacity-50 cursor-not-allowed",
            dynamicBgEnabled && "dark:!bg-[var(--dynamic-bg-dark)]"
          )}
        />

        {/* Save Status Indicator */}
        {status !== 'idle' && (
          <div className={cn(
            "absolute top-6 right-8 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all duration-500 pointer-events-none z-10",
            isZenActive && saveStatus === 'idle' ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0",
            saveStatus === 'saving' ? "text-amber-500 animate-pulse" :
            saveStatus === 'saved' ? "text-emerald-500" :
            saveStatus === 'error' ? "text-red-500" : "text-stone-400"
          )}>
            <div className={cn(
              "w-2 h-2 rounded-full",
              saveStatus === 'saving' ? "bg-amber-500" :
              saveStatus === 'saved' ? "bg-emerald-500" :
              saveStatus === 'error' ? "bg-red-500" : "bg-stone-300"
            )} />
            {saveStatus === 'saving' && t('editor_saving')}
            {saveStatus === 'saved' && t('editor_saved')}
            {saveStatus === 'error' && t('editor_save_error')}
            {saveStatus === 'idle' && lastSavedAt && `${t('editor_saved')} ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          </div>
        )}
      </div>
    </div>
  );
}
