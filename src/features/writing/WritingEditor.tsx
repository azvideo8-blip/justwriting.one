import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Pause, Square, Play, X, X as XIcon, Pin, PinOff, Lock, Check } from 'lucide-react';
import { cn } from '../../core/utils/utils';
import { useLanguage } from '../../core/i18n';
import { useUI } from '../../contexts/UIContext';
import { useWritingSettings } from './contexts/WritingSettingsContext';
import { useWritingStore } from './store/useWritingStore';

interface WritingEditorProps {
  handlePause: () => void;
  handleStart: () => void;
  handleFinish: () => void;
  setShowCancelConfirm: (show: boolean) => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
}

export const WritingEditor = React.memo(function WritingEditor({
  handlePause,
  handleStart,
  handleFinish,
  setShowCancelConfirm,
  saveStatus,
  lastSavedAt
}: WritingEditorProps) {
  const { t } = useLanguage();
  const content = useWritingStore(s => s.content);
  const setContent = useWritingStore(s => s.setContent);
  const title = useWritingStore(s => s.title);
  const setTitle = useWritingStore(s => s.setTitle);
  const status = useWritingStore(s => s.status);
  const wpm = useWritingStore(s => s.wpm);
  const pinnedThoughts = useWritingStore(s => s.pinnedThoughts);
  const setPinnedThoughts = useWritingStore(s => s.setPinnedThoughts);
  const { 
    streamMode, isZenActive, zenModeEnabled, 
    fontSize, fontFamily, stickyHeader 
  } = useWritingSettings();
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
    <div className="space-y-6 transition-all duration-1000 py-8 font-serif">
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
      <div className={cn(
        "flex flex-col gap-4 transition-all duration-1000 z-30 py-2",
        stickyHeader ? "sticky top-[128px] md:top-[120px]" : "relative",
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
                className="w-full px-6 py-4 rounded-2xl border shadow-sm focus:shadow-xl outline-none text-xl font-black transition-all bg-surface-card border-border-subtle text-text-main placeholder:text-text-main/40"
              />
              <button 
                onClick={handlePinSelection}
                className={cn(
                  "p-4 rounded-2xl border transition-all shrink-0 flex items-center justify-center shadow-sm",
                  (pinnedThoughts.length > 0 || showPinnedInput || hasSelection)
                    ? "bg-text-main text-surface-base border-text-main"
                    : "bg-surface-card text-text-main/50 border-border-subtle hover:border-text-main/30 hover:text-text-main"
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
                          className="w-full px-6 py-3 border-2 border-dashed rounded-2xl outline-none text-sm italic font-serif resize-none transition-all bg-surface-card/50 border-border-subtle text-text-main/70 focus:border-text-main/30 placeholder:text-text-main/40"
                        />
                        <button 
                          onClick={() => {
                            setPinnedThoughts(pinnedThoughts.filter((_, i) => i !== index));
                          }}
                          className="absolute top-2 right-2 p-1.5 opacity-0 group-hover/pinned:opacity-100 transition-opacity text-text-main/50 hover:text-text-main"
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
                        className="w-full px-6 py-3 border-2 border-dashed rounded-2xl outline-none text-sm italic font-serif resize-none transition-all bg-surface-card/50 border-border-subtle text-text-main/70 focus:border-text-main/30 placeholder:text-text-main/40"
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
            fontSize: `${fontSize}px`,
            lineHeight: `${fontSize * 1.2}px`,
            fontFamily: fontFamily === 'Inter' ? 'Inter, sans-serif' : 
                        fontFamily === 'Playfair Display' ? '"Playfair Display", serif' :
                        fontFamily === 'JetBrains Mono' ? '"JetBrains Mono", monospace' :
                        fontFamily === 'Cormorant Garamond' ? '"Cormorant Garamond", serif' :
                        fontFamily === 'Space Grotesk' ? '"Space Grotesk", sans-serif' : 'inherit',
            caretColor: undefined,
            userSelect: 'text'
          }}
          className={cn(
            "w-full min-h-[500px] md:min-h-[600px] p-8 md:p-12 rounded-[2.5rem] border shadow-xl focus:shadow-2xl transition-all outline-none resize-none leading-[1.8] bg-transparent border-none shadow-none text-text-main placeholder:text-text-main/40",
            (status === 'idle' || status === 'paused') && "opacity-50 cursor-not-allowed"
          )}
        />
      </div>
    </div>
  );
});
