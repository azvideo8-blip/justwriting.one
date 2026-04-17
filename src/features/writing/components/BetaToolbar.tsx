import React, { useState, useEffect } from 'react';
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

  return (
    <div className="flex items-center gap-2 px-6 py-2">
      {/* 1. НОВАЯ — сброс всего */}
      <button
        onClick={onNew}
        title={t('topbar_new')}
        aria-label={t('topbar_new')}
        className="w-10 h-10 rounded-xl border border-border-subtle flex items-center justify-center text-text-main/60 hover:text-text-main hover:border-text-main/30 shadow-sm transition-all"
      >
        <FilePlus size={15} />
      </button>

      {/* 2. ОТКРЫТЬ — модалка выбора сессий */}
      <button
        onClick={onOpenLog}
        title={t('topbar_open')}
        aria-label={t('topbar_open')}
        className="w-10 h-10 rounded-xl border border-border-subtle flex items-center justify-center text-text-main/60 hover:text-text-main hover:border-text-main/30 shadow-sm transition-all"
      >
        <FolderOpen size={15} />
      </button>

      {/* 3. СОХРАНИТЬ — сохранить без сброса */}
      <button
        onClick={onSave}
        disabled={status === 'idle' || wordCount === 0}
        title={t('topbar_save')}
        aria-label={t('topbar_save')}
        className={cn(
          "w-10 h-10 rounded-xl border flex items-center justify-center transition-all shadow-sm",
          status !== 'idle' && wordCount > 0
            ? "border-border-subtle text-text-main/60 hover:text-text-main hover:border-text-main/30"
            : "border-border-subtle text-text-main/20 cursor-not-allowed"
        )}
      >
        <Save size={15} />
      </button>

      <div className="w-px h-5 bg-border-subtle mx-1" />

      {/* 4. PLAY — активен в idle и paused */}
      <button
        onClick={onPlay}
        disabled={status === 'writing'}
        title={t('beta_play')}
        aria-label={t('beta_play')}
        className={cn(
          "w-10 h-10 rounded-xl border flex items-center justify-center transition-all shadow-sm",
          status !== 'writing'
            ? "border-text-main/30 text-text-main hover:bg-text-main/5"
            : "border-border-subtle text-text-main/25 cursor-not-allowed"
        )}
      >
        <Play size={15} />
      </button>

      {/* 5. PAUSE — активен только в writing */}
      <button
        onClick={onPause}
        disabled={status !== 'writing'}
        title={t('beta_pause')}
        aria-label={t('beta_pause')}
        className={cn(
          "w-10 h-10 rounded-xl border flex items-center justify-center transition-all shadow-sm",
          status === 'writing'
            ? "border-text-main/30 text-text-main hover:bg-text-main/5"
            : "border-border-subtle text-text-main/25 cursor-not-allowed"
        )}
      >
        <Pause size={15} />
      </button>

      {/* 6. STOP — активен в writing и paused */}
      <button
        onClick={onStop}
        disabled={status === 'idle'}
        title={t('beta_stop')}
        aria-label={t('beta_stop')}
        className={cn(
          "w-10 h-10 rounded-xl border flex items-center justify-center transition-all shadow-sm",
          status !== 'idle'
            ? "border-text-main/30 text-text-main hover:bg-text-main/5 font-medium"
            : "border-border-subtle text-text-main/25 cursor-not-allowed"
        )}
      >
        <Square size={15} />
      </button>

      <div className="w-px h-5 bg-border-subtle mx-1" />

      {/* FULLSCREEN — переключение */}
      <button
        onClick={toggleFullscreen}
        title={isFullscreen ? t('beta_exit_fullscreen') : t('beta_fullscreen')}
        aria-label={isFullscreen ? t('beta_exit_fullscreen') : t('beta_fullscreen')}
        className="w-10 h-10 rounded-xl border border-border-subtle flex items-center justify-center text-text-main/60 hover:text-text-main hover:border-text-main/30 shadow-sm transition-all"
      >
        {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
      </button>

      {/* Название справа */}
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder={t('topbar_title_placeholder')}
        className="ml-auto bg-transparent outline-none text-sm text-text-main/50 placeholder:text-text-main/25 text-right max-w-[220px]"
      />
    </div>
  );
}
