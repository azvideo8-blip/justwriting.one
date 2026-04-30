import React, { useState, useEffect } from 'react';
import { 
  Maximize, Minimize, FilePlus, FolderOpen, Save, BookOpen, Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../core/utils/utils';
import { useLanguage } from '../../core/i18n';
import { useWritingSettings } from './contexts/WritingSettingsContext';

import { useWritingStore } from './store/useWritingStore';
import { Toolbar } from './components/Toolbar';
import { HeaderStats } from './components/HeaderStats';

interface WritingHeaderProps {
  handleNewSession: () => void;
  fetchUserSessions: () => void;
  loadingSessions: boolean;
  hasDraft: boolean;
  handlePause: () => void;
  handleStart: () => void;
  handleFinish: () => void;
  setShowCancelConfirm: (show: boolean) => void;
  totalDurationForDeadline?: number | null;
  onOpenSettings: () => void;
  onNew?: () => void;
  onOpenLog?: () => void;
  onSave?: () => void;
  onStop?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
}

export const WritingHeader = React.memo(function WritingHeader({
  handleNewSession,
  fetchUserSessions,
  loadingSessions,
  hasDraft,
  handlePause,
  handleStart,
  handleFinish,
  setShowCancelConfirm,
  onOpenSettings,
  onNew,
  onOpenLog,
  onSave,
  onStop,
  onPlay,
  onPause
}: WritingHeaderProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { t } = useLanguage();
  const { 
    isZenActive, zenModeEnabled, 
    headerVisibility, streamMode,
    lifeLogEnabled, lifeLogVisible, setLifeLogVisible, lifeLogTab, setLifeLogTab
  } = useWritingSettings();

  const status = useWritingStore(s => s.status);
  const title = useWritingStore(s => s.title);
  const setTitle = useWritingStore(s => s.setTitle);
  const seconds = useWritingStore(s => s.seconds);
  const wpm = useWritingStore(s => s.wpm);
  const wordCount = useWritingStore(s => s.wordCount);
  const sessionStartWords = useWritingStore(s => s.sessionStartWords);
  const sessionStartSeconds = useWritingStore(s => s.sessionStartSeconds);
  const sessionType = useWritingStore(s => s.sessionType);
  const wordGoal = useWritingStore(s => s.wordGoal);
  const timerDuration = useWritingStore(s => s.timerDuration);
  
  const setWordGoal = useWritingStore(s => s.setWordGoal);
  const setTimerDuration = useWritingStore(s => s.setTimerDuration);

  const sessionWords = wordCount - sessionStartWords;
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
              <div className="flex items-center gap-2 px-6 py-3 border-b border-border-subtle bg-surface-card/50">
                <button onClick={onNew} title={t('topbar_new')}
                  className="w-10 h-10 rounded-xl border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-text-main transition-all">
                  <FilePlus size={16} />
                </button>
                <button onClick={onOpenLog} title={t('topbar_open')}
                  className="w-10 h-10 rounded-xl border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-text-main transition-all">
                  <FolderOpen size={16} />
                </button>
                <button onClick={onSave} title={t('topbar_save')}
                  className="w-10 h-10 rounded-xl border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-text-main transition-all">
                  <Save size={16} />
                </button>
                <div className="w-px h-5 bg-border-subtle mx-1" />
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={t('topbar_title_placeholder')}
                  className="flex-1 bg-transparent outline-none text-[15px] font-medium text-text-main/60 placeholder:text-text-main/25"
                />
                <div className="flex items-center gap-1 ml-auto">
                  <button
                    onClick={() => {
                      if (!lifeLogVisible || lifeLogTab !== 'log') {
                        setLifeLogTab('log');
                        setLifeLogVisible(true);
                      } else {
                        setLifeLogVisible(false);
                      }
                    }}
                    title={t('lifelog_tab_log')}
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                      lifeLogVisible && lifeLogTab === 'log'
                        ? "bg-text-main/10 text-text-main"
                        : "text-text-main/40 hover:text-text-main hover:bg-text-main/5"
                    )}
                  >
                    <BookOpen size={16} />
                  </button>
                   <button
                     onClick={() => {
                       if (!lifeLogVisible || lifeLogTab !== 'settings') {
                         setLifeLogTab('settings');
                         setLifeLogVisible(true);
                       } else {
                         setLifeLogVisible(false);
                       }
                     }}
                     title={t('lifelog_tab_settings')}
                     className={cn(
                       "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                       lifeLogVisible && lifeLogTab === 'settings'
                         ? "bg-text-main/10 text-text-main"
                         : "text-text-main/40 hover:text-text-main hover:bg-text-main/5"
                     )}
                   >
                     <Settings size={16} />
                   </button>
                   <button
                     onClick={toggleFullscreen}
                     title={t('header_fullscreen')}
                     className="w-10 h-10 rounded-xl border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-text-main transition-all"
                   >
                     {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                   </button>
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
                   <button
                     onClick={() => {
                       if (!lifeLogVisible || lifeLogTab !== 'log') {
                         setLifeLogTab('log');
                         setLifeLogVisible(true);
                       } else {
                         setLifeLogVisible(false);
                       }
                     }}
                     title={t('lifelog_tab_log')}
                     className={cn(
                       "w-9 h-9 rounded-xl flex items-center justify-center transition-all",
                       lifeLogVisible && lifeLogTab === 'log'
                         ? "bg-text-main/10 text-text-main"
                         : "text-text-main/40 hover:text-text-main hover:bg-text-main/5"
                     )}
                   >
                     <BookOpen size={16} />
                   </button>
                    <button
                      onClick={() => {
                        if (!lifeLogVisible || lifeLogTab !== 'settings') {
                          setLifeLogTab('settings');
                          setLifeLogVisible(true);
                        } else {
                          setLifeLogVisible(false);
                        }
                      }}
                      title={t('lifelog_tab_settings')}
                      className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center transition-all",
                        lifeLogVisible && lifeLogTab === 'settings'
                          ? "bg-text-main/10 text-text-main"
                          : "text-text-main/40 hover:text-text-main hover:bg-text-main/5"
                      )}
                    >
                      <Settings size={16} />
                    </button>
                    <button
                     onClick={toggleFullscreen}
                     title={t('header_fullscreen')}
                     className="w-9 h-9 rounded-xl border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-text-main transition-all"
                   >
                     {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                   </button>
                 </div>
              </div>

              <HeaderStats
                wordGoal={wordGoal}
                timerDuration={timerDuration}
                onSetWordGoal={setWordGoal}
                onSetTimerDuration={setTimerDuration}
                sessionWords={sessionWords}
                sessionSeconds={sessionSeconds}
                wordCount={wordCount}
                wpm={wpm}
                status={status}
                visibility={headerVisibility}
              />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});
