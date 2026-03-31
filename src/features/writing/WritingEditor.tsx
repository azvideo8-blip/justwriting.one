import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Pause, Square, Play, X, X as XIcon, Pin, PinOff, Lock, Check } from 'lucide-react';
import { cn } from '../../core/utils/utils';
import { useLanguage } from '../../core/i18n';
import { useUI } from '../../contexts/UIContext';
import { useWritingSettings } from './contexts/WritingSettingsContext';

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
  handlePause: () => void;
  handleStart: () => void;
  handleFinish: () => void;
  setShowCancelConfirm: (show: boolean) => void;
  // dynamicBgEnabled?: boolean;
  wpm?: number;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  stickyHeaderEnabled?: boolean;
  streamMode?: boolean;
}

export const WritingEditor = React.memo(function WritingEditor({
  status,
  title,
  setTitle,
  pinnedThoughts,
  setPinnedThoughts,
  content,
  setContent,
  fontSize,
  fontFamily,
  handlePause,
  handleStart,
  handleFinish,
  setShowCancelConfirm,
  // dynamicBgEnabled = false,
  wpm = 0,
  saveStatus,
  lastSavedAt,
  stickyHeaderEnabled = true,
  streamMode = false,
  // highlights,
  // setHighlights
}: WritingEditorProps) {
  const { t } = useLanguage();
  const { uiVersion } = useUI();
  const { streamMode: streamModeContext, isZenActive, zenModeEnabled } = useWritingSettings();
  const isV2 = uiVersion === '2.0';
  const showZen = isZenActive && zenModeEnabled;
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

  const getCaretCoordinates = (textarea: HTMLTextAreaElement, index: number) => {
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
    
    mirror.textContent = textarea.value.substring(0, index);
    
    const span = document.createElement('span');
    span.textContent = textarea.value.substring(index) || '.';
    mirror.appendChild(span);
    
    document.body.appendChild(mirror);
    
    const spanRect = span.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();
    
    document.body.removeChild(mirror);
    
    return { 
      top: spanRect.top - textareaRect.top + textarea.scrollTop, 
      left: spanRect.left - textareaRect.left 
    };
  };

  // Typewriter mode: scroll textarea to center caret
  React.useLayoutEffect(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      const { top } = getCaretCoordinates(textarea, textarea.selectionStart);
      textarea.scrollTop = top - textarea.clientHeight / 2 + 50;
    }
  }, [content]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (streamMode) {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'c' || e.key === 'v')) {
        e.preventDefault();
      }
    }
  };

  const handleCut = (e: React.ClipboardEvent) => {
    if (streamMode) e.preventDefault();
  };

  const handleCopy = (e: React.ClipboardEvent) => {
    if (streamMode) e.preventDefault();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (streamMode) e.preventDefault();
  };

  return (
    <div 
      className={cn(
        "space-y-6 transition-all duration-1000 py-8",
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
        showZen ? "opacity-0 pointer-events-none -translate-y-4" : "opacity-100 translate-y-0"
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
                  "w-full px-6 py-4 rounded-2xl border shadow-sm focus:shadow-xl outline-none text-xl font-black transition-all",
                  isV2 ? "bg-white/5 border-white/10 text-white placeholder:text-white/60" : "border-stone-200 dark:border-stone-800 dark:text-stone-100",
                  /* dynamicBgEnabled && status === 'writing' && !isV2 ? "bg-[var(--dynamic-bg)]/50 dark:bg-[var(--dynamic-bg-dark)]/50 backdrop-blur-md" : */ (!isV2 && "bg-white dark:bg-stone-900")
                )}
              />
              <button 
                onClick={handlePinSelection}
                className={cn(
                  "p-4 rounded-2xl border transition-all shrink-0 flex items-center justify-center shadow-sm",
                  isV2 ? (
                    (pinnedThoughts.length > 0 || showPinnedInput || hasSelection)
                      ? "bg-white text-black border-white"
                      : "bg-white/5 text-white/50 border-white/10 hover:border-white/30 hover:text-white"
                  ) : (
                    (pinnedThoughts.length > 0 || showPinnedInput || hasSelection)
                      ? "bg-white dark:bg-stone-100 text-stone-900 dark:text-stone-900 border-stone-200 dark:border-stone-800" 
                      : "bg-white dark:bg-stone-900 text-stone-400 border-stone-200 dark:border-stone-800 hover:border-stone-400"
                  )
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
                          className={cn(
                            "w-full px-6 py-3 border-2 border-dashed rounded-2xl outline-none text-sm italic font-serif resize-none transition-all",
                            isV2 ? "bg-white/5 border-white/10 text-white/70 focus:border-white/30 placeholder:text-white/60" : "bg-white dark:bg-stone-950/30 border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-400 focus:border-stone-400 dark:focus:border-stone-600"
                          )}
                        />
                        <button 
                          onClick={() => {
                            setPinnedThoughts(pinnedThoughts.filter((_, i) => i !== index));
                          }}
                          className={cn("absolute top-2 right-2 p-1.5 opacity-0 group-hover/pinned:opacity-100 transition-opacity", isV2 ? "text-white/50 hover:text-white" : "text-stone-400 hover:text-red-500")}
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
                        className={cn(
                          "w-full px-6 py-3 border-2 border-dashed rounded-2xl outline-none text-sm italic font-serif resize-none transition-all",
                          isV2 ? "bg-white/5 border-white/10 text-white/70 focus:border-white/30 placeholder:text-white/40" : "bg-stone-50/50 dark:bg-stone-950/30 border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-400 focus:border-stone-400 dark:focus:border-stone-600"
                        )}
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
          onKeyDown={handleKeyDown}
          onCut={handleCut}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onSelect={checkSelection}
          onKeyUp={checkSelection}
          onMouseUp={checkSelection}
          disabled={status === 'idle' || status === 'paused'}
          placeholder={status === 'idle' ? t('editor_idle_placeholder') : t('editor_writing_placeholder')}
          style={{ 
            fontSize: '25px',
            lineHeight: '30px',
            fontFamily: fontFamily === 'Inter' ? 'Inter, sans-serif' : 
                        fontFamily === 'Playfair Display' ? '"Playfair Display", serif' :
                        fontFamily === 'JetBrains Mono' ? '"JetBrains Mono", monospace' :
                        fontFamily === 'Cormorant Garamond' ? '"Cormorant Garamond", serif' :
                        fontFamily === 'Space Grotesk' ? '"Space Grotesk", sans-serif' : 'inherit',
            // backgroundColor: dynamicBgEnabled && !isV2 ? 'var(--dynamic-bg)' : undefined,
            caretColor: undefined,
            userSelect: 'text'
          }}
          className={cn(
            "w-full min-h-[500px] md:min-h-[600px] p-8 md:p-12 rounded-[2.5rem] border shadow-xl focus:shadow-2xl transition-all outline-none resize-none",
            isV2 ? "leading-[1.8] bg-transparent border-none shadow-none text-white/90 placeholder:text-white/40" : "leading-relaxed border-stone-200 dark:border-stone-800 focus:border-stone-300 dark:focus:border-stone-700 dark:text-stone-100",
            /* !dynamicBgEnabled && !isV2 ? "bg-white dark:bg-stone-900" : "bg-transparent", */
            (status === 'idle' || status === 'paused') && "opacity-50 cursor-not-allowed",
            /* dynamicBgEnabled && !isV2 && "dark:!bg-[var(--dynamic-bg-dark)]" */
          )}
        />
      </div>
    </div>
  );
});
