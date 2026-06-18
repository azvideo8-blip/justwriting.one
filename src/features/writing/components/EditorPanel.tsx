import { useRef, useCallback, useState, type RefObject, type ChangeEvent } from 'react';
import { useContentStore } from '../store/useContentStore';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { KeystrokeTracker } from '../utils/keystrokeTracker';

interface EditorPanelProps {
  keystrokeTrackerRef: RefObject<KeystrokeTracker>;
}

export function EditorPanel({ keystrokeTrackerRef }: EditorPanelProps) {
  const content = useContentStore(s => s.content);
  const setContent = useContentStore(s => s.setContent);
  const title = useContentStore(s => s.title);
  const setTitle = useContentStore(s => s.setTitle);
  const { isZenActive, zenModeEnabled } = useWritingSettings();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [titleFocused, setTitleFocused] = useState(false);
  const titleDecayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [titleTyping, setTitleTyping] = useState(false);

  const handleTitleKey = useCallback(() => {
    setTitleTyping(true);
    if (titleDecayRef.current) clearTimeout(titleDecayRef.current);
    titleDecayRef.current = setTimeout(() => setTitleTyping(false), 1000);
  }, []);

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    keystrokeTrackerRef.current?.record();
  }, [setContent, keystrokeTrackerRef]);

  const showZen = isZenActive && zenModeEnabled;
  const titleActive = titleFocused || titleTyping;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Title input with focus glow matching the main editor feel */}
      <div style={{
        position: 'relative',
        transition: 'all 0.4s ease',
      }}>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setTitleFocused(true)}
          onBlur={() => setTitleFocused(false)}
          onKeyDown={handleTitleKey}
          placeholder="Title"
          style={{
            boxShadow: titleActive
              ? `0 2px 0 0 color-mix(in srgb, var(--flow-pulse-color) ${titleTyping ? '60%' : '30%'}, transparent), 0 4px 16px color-mix(in srgb, var(--flow-pulse-color) ${titleTyping ? '15%' : '6%'}, transparent)`
              : 'none',
            transition: 'box-shadow 0.4s ease',
          }}
          className={`w-full bg-transparent outline-none font-bold text-xl pb-0.5 ${showZen ? 'text-text-main/60 placeholder:text-text-main/40' : 'text-text-main placeholder:text-text-main/40'}`}
        />
      </div>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        placeholder="Start writing..."
        className={`flex-1 w-full bg-transparent outline-none resize-none leading-relaxed ${showZen ? 'text-text-main/70 placeholder:text-text-main/40' : 'text-text-main placeholder:text-text-main/40'}`}
        autoFocus
      />
    </div>
  );
}
