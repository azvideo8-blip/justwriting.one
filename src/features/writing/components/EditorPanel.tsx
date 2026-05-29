import { useRef, useCallback, type RefObject, type ChangeEvent } from 'react';
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

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    keystrokeTrackerRef.current?.record();
  }, [setContent, keystrokeTrackerRef]);

  const showZen = isZenActive && zenModeEnabled;

  return (
    <div className="flex flex-col gap-3 h-full">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className={`w-full bg-transparent outline-none font-bold text-xl ${showZen ? 'text-text-main/60 placeholder:text-text-main/20' : 'text-text-main placeholder:text-text-main/30'}`}
      />
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        placeholder="Start writing..."
        className={`flex-1 w-full bg-transparent outline-none resize-none leading-relaxed ${showZen ? 'text-text-main/70 placeholder:text-text-main/20' : 'text-text-main placeholder:text-text-main/30'}`}
        autoFocus
      />
    </div>
  );
}
