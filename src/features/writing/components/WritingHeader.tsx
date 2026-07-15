import React, { useState, useEffect } from 'react';
import { 
  Maximize, Minimize, FilePlus, FolderOpen, Save, BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { IconButton } from '../../../shared/components/IconButton';

import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { Toolbar } from './Toolbar';
import { HeaderStats } from './HeaderStats';
import { AIToggleButton } from './AIPanel';

interface WritingHeaderProps {
  totalDurationForDeadline?: number | null;
  onNew?: () => void;
  onOpenLog?: () => void;
  onSave?: () => void;
  onStop?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
}

export const WritingHeader = React.memo(function WritingHeader({
  onNew,
  onOpenLog,
  onSave,
  onStop,
  onPlay,
  onPause,
  saveStatus,
}: WritingHeaderProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { t } = useLanguage();
  const { 
    isZenActive, zenModeEnabled, 
    headerVisibility,
    lifeLogEnabled, lifeLogVisible, setLifeLogVisible, lifeLogTab, setLifeLogTab,
    aiPanelOpen, setAiPanelOpen
  } = useWritingSettings();

  const status = useTimerStore(s => s.status);
  const title = useContentStore(s => s.title);
  const setTitle = useContentStore(s => s.setTitle);
  const seconds = useTimerStore(s => s.seconds);
  const wpm = useContentStore(s => s.wpm);
  const wordCount = useContentStore(s => s.wordCount);
  const sessionStartWords = useTimerStore(s => s.sessionStartWords);
  const sessionStartSeconds = useTimerStore(s => s.sessionStartSeconds);
  const wordGoal = useTimerStore(s => s.wordGoal);
  const timerDuration = useTimerStore(s => s.timerDuration);
  
  const setWordGoal = useTimerStore(s => s.setWordGoal);
  const setTimerDuration = useTimerStore(s => s.setTimerDuration);

  const sessionWords = Math.max(0, wordCount - sessionStartWords);
  const sessionSeconds = Math.max(0, seconds - sessionStartSeconds);

  const showZen = isZenActive && zenModeEnabled;

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
    <AnimatePresence>
      {!showZen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className={cn(
            "w-full z-40 shrink-0",
            lifeLogEnabled ? "overflow-hidden" : "px-4 py-3 overflow-visible"
          )}
        >
          {lifeLogEnabled ? (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border-subtle bg-surface-card/50 min-h-[56px]">
                <IconButton icon={<FilePlus size={16} aria-hidden="true" />} label={t('topbar_new')} onClick={onNew} />
                <IconButton icon={<FolderOpen size={16} aria-hidden="true" />} label={t('topbar_open')} onClick={onOpenLog} />
                <IconButton icon={<Save size={16} aria-hidden="true" />} label={t('topbar_save')} onClick={onSave} />
                <div className="w-px h-5 bg-border-subtle mx-1" />
                <input
                  aria-label={t('topbar_title_placeholder')}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={t('topbar_title_placeholder')}
                  maxLength={200}
                  className="flex-1 min-w-[120px] bg-transparent outline-none text-[15px] font-medium font-sans text-text-main/60 focus:text-text-main focus:shadow-[0_0_25px_color-mix(in_srgb,var(--brand-soft)_15%,transparent)] placeholder:text-text-main/40 transition-all duration-500"
                />
                <div className="flex items-center gap-1 ml-auto">
                   <IconButton
                     icon={<BookOpen size={16} aria-hidden="true" />}
                     label={t('lifelog_tab_log')}
                     active={lifeLogVisible && lifeLogTab === 'log'}
                     onClick={() => {
                       if (!lifeLogVisible || lifeLogTab !== 'log') {
                         setLifeLogTab('log');
                         setLifeLogVisible(true);
                       } else {
                         setLifeLogVisible(false);
                       }
                     }}
                   />
                   <AIToggleButton
                     active={aiPanelOpen}
                     onClick={() => setAiPanelOpen(!aiPanelOpen)}
                   />
                    <IconButton
                     icon={isFullscreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
                     label={isFullscreen ? t('header_exit_fullscreen') : t('header_fullscreen')}
                     onClick={toggleFullscreen}
                   />
                 </div>
               </div>
          ) : (
            <div className="w-full mx-auto flex flex-col gap-0 bg-surface-card backdrop-blur-2xl border border-border-subtle shadow-sm overflow-visible">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
                <Toolbar 
                  onNew={onNew}
                  onOpenLog={onOpenLog}
                  onSave={onSave}
                  onPlay={onPlay}
                  onPause={onPause}
                  onStop={onStop}
                  status={status}
                  wordCount={wordCount}
                  title={title}
                  setTitle={setTitle}
                />
                <div className="flex items-center gap-1.5 ml-auto">
                    <IconButton
                      icon={<BookOpen size={16} aria-hidden="true" />}
                      label={t('lifelog_tab_log')}
                      active={lifeLogVisible && lifeLogTab === 'log'}
                      onClick={() => {
                        if (!lifeLogVisible || lifeLogTab !== 'log') {
                          setLifeLogTab('log');
                          setLifeLogVisible(true);
                        } else {
                          setLifeLogVisible(false);
                        }
                      }}
                    />
                     <IconButton
                      icon={isFullscreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
                      label={isFullscreen ? t('header_exit_fullscreen') : t('header_fullscreen')}
                      onClick={toggleFullscreen}
                    />
                 </div>
              </div>

              <HeaderStats
                wordGoal={wordGoal}
                timerDuration={timerDuration}
                onSetWordGoal={(v) => setWordGoal(v, wordCount)}
                onSetTimerDuration={setTimerDuration}
                sessionWords={sessionWords}
                sessionSeconds={sessionSeconds}
                wordCount={wordCount}
                wpm={wpm}
                status={status}
                visibility={headerVisibility}
              />
              <AnimatePresence>
                {saveStatus === 'saving' && (
                  <motion.span
                    key="saving"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="font-mono text-label text-text-main/60 tracking-widest uppercase ml-3"
                  >
                    {t('editor_saving')}
                  </motion.span>
                )}
                {saveStatus === 'saved' && (
                  <motion.span
                    key="saved"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex items-center gap-1 font-mono text-label text-text-main/60 tracking-widest uppercase ml-3"
                  >
                    <motion.svg viewBox="0 0 12 10" width={12} height={10}>
                      <motion.path
                        d="M1 5 L4.5 8.5 L11 1"
                        stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round"
                        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                      />
                    </motion.svg>
                    {t('editor_saved')}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});
