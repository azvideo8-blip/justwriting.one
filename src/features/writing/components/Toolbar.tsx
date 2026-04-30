import React, { useState, useEffect, useRef } from 'react';
import { FilePlus, FolderOpen, Save, Play, Pause, Square, Flag } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';

interface ToolbarProps {
  onNew?: () => void;
  onOpenLog?: () => void;
  onSave?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  status: string;
  wordCount: number;
  title: string;
  setTitle: (t: string) => void;
}

export function Toolbar({
  onNew,
  onOpenLog,
  onSave,
  onPlay,
  onPause,
  onStop,
  status,
  wordCount,
  title,
  setTitle
}: ToolbarProps) {
  const { t } = useLanguage();

  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.scrollLeft = titleRef.current.scrollWidth;
    }
  }, [title]);

  return (
    <div className="flex items-center gap-1.5 py-1 w-full">
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onNew}
          title={t('topbar_new')}
          aria-label={t('topbar_new')}
          className="w-9 h-9 flex items-center justify-center text-text-main/50 hover:text-text-main hover:bg-text-main/5 transition-all"
        >
          <FilePlus size={16} />
        </button>

        <button
          onClick={onOpenLog}
          title={t('topbar_open')}
          aria-label={t('topbar_open')}
          className="w-9 h-9 flex items-center justify-center text-text-main/50 hover:text-text-main hover:bg-text-main/5 transition-all"
        >
          <FolderOpen size={16} />
        </button>

        <button
          onClick={onSave}
          disabled={status === 'idle' || wordCount === 0}
          title={t('topbar_save')}
          aria-label={t('topbar_save')}
          className={cn(
            "w-9 h-9 flex items-center justify-center transition-all",
            status !== 'idle' && wordCount > 0
              ? "text-text-main/50 hover:text-text-main hover:bg-text-main/5"
              : "text-text-main/20 cursor-not-allowed"
          )}
        >
          <Save size={16} />
        </button>

        <div className="w-px h-5 bg-border-subtle mx-0.5" />

        <button
          onClick={onPlay}
          disabled={status === 'writing'}
          title={t('play')}
          aria-label={t('play')}
          className={cn(
            "w-9 h-9 flex items-center justify-center transition-all",
            status !== 'writing'
              ? "text-text-main hover:bg-text-main/5"
              : "text-text-main/15 cursor-not-allowed"
          )}
        >
          <Play size={16} />
        </button>

        <button
          onClick={onPause}
          disabled={status !== 'writing'}
          title={t('pause')}
          aria-label={t('pause')}
          className={cn(
            "w-9 h-9 flex items-center justify-center transition-all",
            status === 'writing'
              ? "text-accent-warning hover:bg-accent-warning/10"
              : "text-text-main/15 cursor-not-allowed"
          )}
        >
          <Pause size={16} />
        </button>

        <button
          onClick={onStop}
          disabled={status === 'idle'}
          title={status !== 'idle' ? t('header_finish') : t('stop')}
          aria-label={status !== 'idle' ? t('header_finish') : t('stop')}
          className={cn(
            "w-9 h-9 flex items-center justify-center transition-all",
            status !== 'idle'
              ? "text-accent-danger hover:bg-accent-danger/10"
              : "text-text-main/15 cursor-not-allowed"
          )}
        >
          {status !== 'idle' ? <Flag size={16} /> : <Square size={16} />}
        </button>
      </div>

      <div className="ml-2 flex-1 min-w-0">
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('topbar_title_placeholder')}
          className="w-full bg-surface-base/50 border border-border-subtle/60 rounded-lg px-2.5 py-1 text-[15px] text-text-main placeholder:text-text-main/25 outline-none focus:border-text-main/30 transition-all"
        />
      </div>
    </div>
  );
}
