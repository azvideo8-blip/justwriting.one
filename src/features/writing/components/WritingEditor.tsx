import React from 'react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { getFontStack } from '../utils/fontStack';
import { useToast } from '../../../shared/components/Toast';
import { useCaretEffects } from '../hooks/useCaretEffects';
import { useAutoHideCursor } from '../hooks/useAutoHideCursor';
import { getPromptOfDay } from '../utils/promptOfDay';
import { formatRussianTypography } from '../utils/typography';

interface WritingEditorProps {
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export const WritingEditor = React.memo(function WritingEditor({
  onKeyDown
}: WritingEditorProps) {
  const { t } = useLanguage();
  const content = useContentStore(s => s.content);
  const setContent = useContentStore(s => s.setContent);
  const isPaused = useTimerStore(s => s.status === 'paused');
  const { 
    streamMode, 
    fontSize, fontFamily,
    lineHeight,
    lifeLogEnabled,
    typewriterScrolling,
    focusModeEnabled,
    autoHideCursor,
    silenceMode,
    typographyEnabled,
  } = useWritingSettings();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const streamStatusRef = React.useRef<HTMLSpanElement>(null);
  const { showToast } = useToast();
  const blockToastShownRef = React.useRef(false);
  const editorStyle = {
    fontSize: `${fontSize}px`,
    lineHeight: `${lineHeight}`,
    fontFamily: getFontStack(fontFamily),
    userSelect: 'text' as const,
    // Typewriter mode: extra bottom room so the last lines can scroll up to
    // the vertical center instead of sticking to the bottom edge.
    ...(typewriterScrolling ? { paddingBottom: '45vh' } : {}),
  };

  useCaretEffects(textareaRef, { typewriter: typewriterScrolling, focusBand: focusModeEnabled });
  useAutoHideCursor(containerRef, autoHideCursor);

  React.useEffect(() => {
    if (isPaused) return;
    const isMobile = typeof window !== 'undefined' && (window.innerWidth < 768 || ('ontouchstart' in window && window.innerWidth < 1024));
    if (!isMobile && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isPaused]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (streamMode) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (streamStatusRef.current) {
          streamStatusRef.current.textContent = t('stream_mode_blocked');
        }
        if (!blockToastShownRef.current) {
          blockToastShownRef.current = true;
          showToast(t('stream_mode_blocked'), 'error');
          setTimeout(() => { blockToastShownRef.current = false; }, 5000);
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'c' || e.key === 'v')) {
        e.preventDefault();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !isPaused) {
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        const res = e.shiftKey ? useContentStore.getState().redo() : useContentStore.getState().undo();
        if (res && textareaRef.current) {
          const el = textareaRef.current;
          requestAnimationFrame(() => {
            const caret = Math.min(res.caret, el.value.length);
            try { el.setSelectionRange(caret, caret); } catch { /* ignore */ }
          });
        }
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        const res = useContentStore.getState().redo();
        if (res && textareaRef.current) {
          const el = textareaRef.current;
          requestAnimationFrame(() => {
            const caret = Math.min(res.caret, el.value.length);
            try { el.setSelectionRange(caret, caret); } catch { /* ignore */ }
          });
        }
        return;
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

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const rawValue = e.target.value;
    const cursorPos = e.target.selectionStart ?? rawValue.length;

    if (typographyEnabled && rawValue.length >= content.length) {
      const { text: formattedText, newCursorPos } = formatRussianTypography(rawValue, cursorPos);
      setContent(formattedText, newCursorPos);
      if (formattedText !== rawValue && textareaRef.current) {
        const el = textareaRef.current;
        requestAnimationFrame(() => {
          try {
            el.setSelectionRange(newCursorPos, newCursorPos);
          } catch {
            // ignore range error
          }
        });
      }
    } else {
      setContent(rawValue, cursorPos);
    }
  };

  const placeholder = content.trim() === '' ? getPromptOfDay(t) : t('writing_placeholder');

  return (
    <div
      ref={containerRef}
      className={cn(
        "transition-all duration-1000 flex flex-col",
        lifeLogEnabled ? "h-full overflow-hidden" : "space-y-4 py-4 font-serif",
        focusModeEnabled && "focus-mode-active",
        silenceMode && "max-w-[68ch] w-full"
      )}
    >

      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleContentChange}
        onKeyDown={(e) => {
          handleKeyDown(e);
          onKeyDown?.(e);
        }}
        onCut={handleCut}
        onCopy={handleCopy}
        onPaste={handlePaste}
        readOnly={isPaused}
        aria-label={t('writing_placeholder')}
        placeholder={placeholder}
        style={editorStyle}
        className={cn(
          "w-full outline-none resize-none leading-[1.8] text-text-main placeholder:text-text-main/40 flex-1 min-h-0",
          lifeLogEnabled
            ? "bg-transparent border-0 shadow-none p-4 md:p-6 overflow-y-auto custom-scrollbar"
            : silenceMode
              ? "min-h-[500px] md:min-h-[600px] p-8 md:p-12 rounded-3xl border border-transparent shadow-none bg-transparent transition-colors custom-scrollbar"
              : "min-h-[500px] md:min-h-[600px] p-8 md:p-12 rounded-3xl border border-border-subtle/40 backdrop-blur-sm bg-text-main/[0.02] shadow-xl focus:shadow-2xl transition-colors custom-scrollbar"
        )}
      />
      <span
        role="status"
        aria-live="polite"
        className="sr-only"
        ref={streamStatusRef}
      />
    </div>
  );
});
