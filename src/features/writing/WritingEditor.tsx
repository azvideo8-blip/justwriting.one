import React from 'react';
import { cn } from '../../core/utils/utils';
import { useLanguage } from '../../core/i18n';
import { useWritingSettings } from './contexts/WritingSettingsContext';
import { useWritingStore } from './store/useWritingStore';
import { getFontStack } from './utils/fontStack';

interface WritingEditorProps {
  handlePause: () => void;
  handleStart: () => void;
  handleFinish: () => void;
  setShowCancelConfirm: (show: boolean) => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export const WritingEditor = React.memo(function WritingEditor({
  handlePause: _handlePause,
  handleStart: _handleStart,
  handleFinish: _handleFinish,
  setShowCancelConfirm: _setShowCancelConfirm,
  saveStatus: _saveStatus,
  lastSavedAt: _lastSavedAt,
  onKeyDown
}: WritingEditorProps) {
  const { t } = useLanguage();
  const content = useWritingStore(s => s.content);
  const setContent = useWritingStore(s => s.setContent);
  const status = useWritingStore(s => s.status);
  const { 
    streamMode, isZenActive, zenModeEnabled, 
    fontSize, fontFamily,
    lifeLogEnabled
  } = useWritingSettings();
  const showZen = isZenActive && zenModeEnabled;
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

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
    <div className={cn(
      "transition-all duration-1000",
      lifeLogEnabled ? "h-full overflow-hidden" : "space-y-4 py-4 font-serif"
    )}>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          handleKeyDown(e);
          onKeyDown?.(e);
        }}
        onCut={handleCut}
        onCopy={handleCopy}
        onPaste={handlePaste}
        placeholder={t('writing_placeholder')}
        style={{ 
          fontSize: `${fontSize}px`,
          lineHeight: `${fontSize * 1.2}px`,
          fontFamily: getFontStack(fontFamily),
          caretColor: undefined,
          userSelect: 'text'
        }}
        className={cn(
          "w-full outline-none resize-none leading-[1.8] text-text-main placeholder:text-text-main/40",
          lifeLogEnabled
            ? "h-full min-h-0 bg-transparent border-0 shadow-none p-4 md:p-6 overflow-y-auto"
            : "min-h-[500px] md:min-h-[600px] p-8 md:p-12 rounded-3xl border border-border-subtle/40 backdrop-blur-sm bg-text-main/[0.02] shadow-xl focus:shadow-2xl transition-all"
        )}
      />
    </div>
  );
});
