import React from 'react';
import { cn } from '../../core/utils/utils';
import { useLanguage } from '../../core/i18n';
import { useWritingSettings } from './contexts/WritingSettingsContext';
import { useContentStore } from './store/useContentStore';
import { useTimerStore } from './store/useTimerStore';
import { getFontStack } from './utils/fontStack';
import { Pin, Plus, X } from 'lucide-react';

interface WritingEditorProps {
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export const WritingEditor = React.memo(function WritingEditor({
  onKeyDown
}: WritingEditorProps) {
  const { t } = useLanguage();
  const content = useContentStore(s => s.content);
  const setContent = useContentStore(s => s.setContent);
  const pinnedThoughts = useContentStore(s => s.pinnedThoughts || []);
  const setPinnedThoughts = useContentStore(s => s.setPinnedThoughts);
  const _status = useTimerStore(s => s.status);
  const { 
    streamMode, isZenActive, zenModeEnabled, 
    fontSize, fontFamily,
    lifeLogEnabled
  } = useWritingSettings();
  const _showZen = isZenActive && zenModeEnabled;
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const [newThought, setNewThought] = React.useState('');
  const [showAddForm, setShowAddForm] = React.useState(false);

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

  const handleAddThought = () => {
    if (newThought.trim()) {
      setPinnedThoughts([...pinnedThoughts, newThought.trim()]);
      setNewThought('');
      setShowAddForm(false);
    }
  };

  return (
    <div className={cn(
      "transition-all duration-1000 flex flex-col",
      lifeLogEnabled ? "h-full overflow-hidden" : "space-y-4 py-4 font-serif"
    )}>
      {/* Pinned thoughts are disabled by user preference, but kept as commented code for reference */}
      {/* 
      {!_showZen && (
        <div className="px-4 py-1.5 flex items-center justify-between gap-2 border-b border-border-subtle/20 shrink-0">
          <div className="flex items-center gap-1.5 text-text-main/55 text-xs font-semibold uppercase tracking-wider">
            <Pin size={12} className="rotate-45" />
            <span>{t('editor_pinned_thoughts')}</span>
            <span className="font-mono text-[10px] lowercase text-text-main/30">({pinnedThoughts.length})</span>
          </div>
          
          <button 
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-1 rounded-lg text-text-main/40 hover:text-text-main hover:bg-text-main/5 transition-all"
            title={t('editor_pin_thought')}
          >
            {showAddForm ? <X size={14} /> : <Plus size={14} />}
          </button>
        </div>
      )}
      */}

      {/* Add Thought Form */}
      {/* 
      {showAddForm && (
        <div className="p-3 bg-text-main/[0.02] border-b border-border-subtle/20 flex gap-2 items-center shrink-0">
          <input
            type="text"
            value={newThought}
            onChange={e => setNewThought(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleAddThought();
                e.preventDefault();
              }
            }}
            placeholder={t('editor_add_thought')}
            className="flex-1 bg-surface-base text-xs text-text-main/80 placeholder:text-text-main/30 px-3 py-2 rounded-xl border border-border-subtle/40 outline-none focus:border-text-main/30"
            autoFocus
          />
          <button
            onClick={handleAddThought}
            className="px-3 py-2 bg-text-main text-surface-base text-xs font-medium rounded-xl hover:opacity-90"
          >
            {t('editor_pin_thought')}
          </button>
        </div>
      )}
      */}

      {/* Pinned Thoughts List (with Soft Edge Content Fade) */}
      {/* 
      {pinnedThoughts.length > 0 && (
        <div className="shrink-0 px-4 py-2 bg-text-main/[0.01] border-b border-border-subtle/10 max-h-[85px] overflow-hidden relative">
          <div className="max-h-[70px] overflow-y-auto custom-scrollbar soft-edge-fade space-y-1 pr-1">
            {pinnedThoughts.map((thought, idx) => (
              <div key={idx} className="text-xs text-text-main/70 bg-text-main/[0.02] border border-border-subtle/20 rounded-lg px-2.5 py-1.5 flex items-center justify-between group">
                <span className="truncate flex-1">{thought}</span>
                <button
                  onClick={() => setPinnedThoughts(pinnedThoughts.filter((_, i) => i !== idx))}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-main/30 hover:text-accent-danger hover:bg-text-main/5 transition-all ml-2"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      */}

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
        readOnly={_status === 'paused'}
        aria-label={t('writing_placeholder')}
        placeholder={t('writing_placeholder')}
        style={{
          fontSize: `${fontSize}px`,
          lineHeight: `${fontSize * 1.2}px`,
          fontFamily: getFontStack(fontFamily),
          userSelect: 'text'
        }}
        className={cn(
          "w-full outline-none resize-none leading-[1.8] text-text-main placeholder:text-text-main/40 flex-1 min-h-0",
          lifeLogEnabled
            ? "bg-transparent border-0 shadow-none p-4 md:p-6 overflow-y-auto custom-scrollbar"
            : "min-h-[500px] md:min-h-[600px] p-8 md:p-12 rounded-3xl border border-border-subtle/40 backdrop-blur-sm bg-text-main/[0.02] shadow-xl focus:shadow-2xl transition-all custom-scrollbar"
        )}
      />
    </div>
  );
});

