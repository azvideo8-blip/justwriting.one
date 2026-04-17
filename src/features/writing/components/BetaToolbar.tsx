import React, { useState, useEffect, useRef } from 'react';
import { FilePlus, FolderOpen, Save, Play, Pause, Square, Maximize, Minimize } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';

interface BetaToolbarProps {
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

export function BetaToolbar({
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
}: BetaToolbarProps) {
  const { t } = useLanguage();
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.scrollLeft = titleRef.current.scrollWidth;
    }
  }, [title]);

  return (
    <div className="flex items-center gap-1.5 py-1">
      {/* 1. НОВАЯ — сброс всего */}
      <button
        onClick={onNew}
        title={t('topbar_new')}
        aria-label={t('topbar_new')}
        className="w-10 h-10 rounded-xl border border-border-subtle/60 bg-surface-base/30 flex items-center justify-center text-text-main/50 hover:text-text-main hover:border-border-subtle hover:bg-surface-base/50 transition-all"
      >
        <FilePlus size={16} />
      </button>

      {/* 2. ОТКРЫТЬ */}
      <button
        onClick={onOpenLog}
        title={t('topbar_open')}
        aria-label={t('topbar_open')}
        className="w-10 h-10 rounded-xl border border-border-subtle/60 bg-surface-base/30 flex items-center justify-center text-text-main/50 hover:text-text-main hover:border-border-subtle hover:bg-surface-base/50 transition-all"
      >
        <FolderOpen size={16} />
      </button>

      {/* 3. СОХРАНИТЬ */}
      <button
        onClick={onSave}
        disabled={status === 'idle' || wordCount === 0}
        title={t('topbar_save')}
        aria-label={t('topbar_save')}
        className={cn(
          "w-10 h-10 rounded-xl border flex items-center justify-center transition-all",
          status !== 'idle' && wordCount > 0
            ? "border-border-subtle/60 bg-surface-base/30 text-text-main/50 hover:text-text-main hover:border-border-subtle hover:bg-surface-base/50"
            : "border-border-subtle/40 text-text-main/20 cursor-not-allowed"
        )}
      >
        <Save size={16} />
      </button>

      <div className="w-px h-5 bg-border-subtle mx-0.5" />

      {/* 4. PLAY */}
      <button
        onClick={onPlay}
        disabled={status === 'writing'}
        title={t('beta_play')}
        aria-label={t('beta_play')}
        className={cn(
          "w-10 h-10 rounded-xl border flex items-center justify-center transition-all",
          status !== 'writing'
            ? "border-text-main/40 text-text-main bg-text-main/5 hover:bg-text-main/10"
            : "border-border-subtle/40 text-text-main/15 cursor-not-allowed"
        )}
      >
        <Play size={16} />
      </button>

      {/* 5. PAUSE */}
      <button
        onClick={onPause}
        disabled={status !== 'writing'}
        title={t('beta_pause')}
        aria-label={t('beta_pause')}
        className={cn(
          "w-10 h-10 rounded-xl border flex items-center justify-center transition-all",
          status === 'writing'
            ? "border-accent-warning/40 text-accent-warning bg-accent-warning/5 hover:bg-accent-warning/10"
            : "border-border-subtle/40 text-text-main/15 cursor-not-allowed"
        )}
      >
        <Pause size={16} />
      </button>

      {/* 6. STOP */}
      <button
        onClick={onStop}
        disabled={status === 'idle'}
        title={t('beta_stop')}
        aria-label={t('beta_stop')}
        className={cn(
          "w-10 h-10 rounded-xl border flex items-center justify-center transition-all",
          status !== 'idle'
            ? "border-accent-danger/40 text-accent-danger bg-accent-danger/5 hover:bg-accent-danger/10"
            : "border-border-subtle/40 text-text-main/15 cursor-not-allowed"
        )}
      >
        <Square size={16} />
      </button>

      <div className="w-px h-5 bg-border-subtle mx-0.5" />

      {/* FULLSCREEN */}
      <button
        onClick={toggleFullscreen}
        title={isFullscreen ? t('beta_exit_fullscreen') : t('beta_fullscreen')}
        aria-label={isFullscreen ? t('beta_exit_fullscreen') : t('beta_fullscreen')}
        className="w-10 h-10 rounded-xl border border-border-subtle/60 bg-surface-base/30 flex items-center justify-center text-text-main/50 hover:text-text-main hover:border-border-subtle hover:bg-surface-base/50 transition-all"
      >
        {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
      </button>

      {/* Название сессии */}
      <div className="ml-2 flex-1 min-w-0">
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('topbar_title_placeholder')}
          className="w-full bg-surface-base/50 border border-border-subtle/60 rounded-lg px-2.5 py-1 text-sm text-text-main placeholder:text-text-main/25 outline-none focus:border-text-main/30 transition-all"
        />
      </div>
    </div>
  );
}
