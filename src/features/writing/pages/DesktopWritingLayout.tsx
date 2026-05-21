import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Session, UserProfile } from '../../../types';
import { cn } from '../../../core/utils/utils';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useLanguage } from '../../../core/i18n';

import { WritingHeader } from '../WritingHeader';
import { WritingEditor } from '../WritingEditor';
import { WritingSetup, SetupMode } from '../WritingSetup';
import { LifeLogPanel } from '../components/LifeLogPanel';
import { BottomStats } from '../components/BottomStats';
import { Sidebar } from '../../navigation/components/Sidebar';
import { ConnectionStatusBanner } from '../components/ConnectionStatusBanner';
import { AIPanel } from '../components/AIPanel';
import { KeystrokeTracker } from '../utils/keystrokeTracker';

interface DesktopWritingLayoutProps {
  profile: UserProfile | null;
  setupMode: SetupMode | null;
  setSetupMode: (mode: SetupMode | null) => void;
  startCountdown: (type: 'stopwatch' | 'timer' | 'words' | 'finish-by') => void;
  countdown: number | null;
  totalDurationForDeadline: number;
  onOpenSettings: () => void;
  onNew: () => void;
  onOpenLog: () => void;
  onSave: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onContinueSession: (session: Session) => void;
  handlePlayRef: React.MutableRefObject<() => void>;
  keystrokeTrackerRef: React.MutableRefObject<KeystrokeTracker>;
  hasDraft: boolean;
  sessionStatus: string;
  userId: string;
  onContinueSessionOrDoc: (session: Session) => void;
  restoreDraft: () => void;
  discardDraft: () => void;
  onSetPromptTitle: (title: string) => void;
  showZen: boolean;
  lifeLogVisible: boolean;
  setLifeLogVisible: (v: boolean) => void;
  lifeLogTab: 'log' | 'settings';
  setLifeLogTab: (t: 'log' | 'settings') => void;
  lifeLogPinned: boolean;
  setLifeLogPinned: (v: boolean) => void;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  streakDays?: number;
  aiPanelOpen: boolean;
  onToggleAI: () => void;
}

export function DesktopWritingLayout({
  profile,
  setupMode, setSetupMode, startCountdown,
  countdown, totalDurationForDeadline,
  onOpenSettings, onNew, onOpenLog, onSave, onPlay, onPause, onStop,
  onContinueSession, handlePlayRef, keystrokeTrackerRef,
  hasDraft, sessionStatus, userId,
  onContinueSessionOrDoc, restoreDraft, discardDraft,
  onSetPromptTitle,
  showZen, lifeLogVisible, setLifeLogVisible,
  lifeLogTab, setLifeLogTab, lifeLogPinned, setLifeLogPinned,
  saveStatus,
  streakDays,
  aiPanelOpen,
  onToggleAI,
}: DesktopWritingLayoutProps) {
  const { t } = useLanguage();
  const editorColRef = React.useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = React.useState(false);
  const { editorWidth } = useWritingSettings();

  React.useEffect(() => {
    const el = editorColRef.current;
    if (!el) return;
    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const entry = el.getBoundingClientRect();
        setIsCompact(entry.width < 600);
        rafId = null;
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  const LIFE_LOG_WIDTH = 380;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full transition-colors duration-1000"
    >
      <ConnectionStatusBanner showZen={showZen} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${showZen ? '0px' : 'auto'} 1fr ${lifeLogVisible ? `${LIFE_LOG_WIDTH}px` : '0px'}`,
          gridTemplateRows: '48px 1fr 64px',
          height: '100vh',
          width: '100vw',
          position: 'fixed',
          inset: 0,
          zIndex: 20,
          transition: 'grid-template-columns 0.25s cubic-bezier(.4,.2,.2,1)',
          overflow: 'hidden',
        }}
      >
        <div style={{ gridColumn: '1', gridRow: '1 / 4', overflow: 'hidden' }}>
          <Sidebar isAdmin={!!profile?.role && profile.role === 'admin'} inGrid onOpenSettings={onOpenSettings} />
        </div>

        <div style={{ gridColumn: '2', gridRow: '1', overflow: 'hidden' }}>
          <WritingHeader
            totalDurationForDeadline={totalDurationForDeadline}
            onOpenSettings={onOpenSettings}
            onNew={onNew}
            onOpenLog={onOpenLog}
            onSave={onSave}
            onPlay={onPlay}
            onPause={onPause}
            onStop={onStop}
            saveStatus={saveStatus}
            aiPanelOpen={aiPanelOpen}
            onToggleAI={onToggleAI}
          />
        </div>

        <div ref={editorColRef} style={{
          gridColumn: '2',
          gridRow: '2',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}>
          <AnimatePresence>
            {hasDraft && sessionStatus === 'idle' && !setupMode && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                className="shrink-0 flex items-center justify-center overflow-hidden"
              >
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-text-main/10 bg-surface-card/90 backdrop-blur-xl shadow-lg text-sm text-text-main/60 whitespace-nowrap">
                  <span>{t('draft_restore_prompt')}</span>
                  <div className="flex gap-2">
                    <button onClick={restoreDraft} className="text-text-main font-medium hover:opacity-70 transition-opacity">
                      {t('draft_restore')}
                    </button>
                    <button onClick={discardDraft}
                      className="text-text-main/40 hover:text-text-main/60 transition-colors">
                      {t('draft_discard')}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div style={{
            width: editorWidth < 100 ? `${editorWidth}%` : '100%',
            flex: '1 1 0',
            minHeight: 0,
            position: 'relative',
            alignSelf: 'center',
          }}
          className={cn(
            editorWidth < 100 && "rounded-2xl m-2 border border-border-subtle/40 backdrop-blur-sm bg-text-main/[0.02] shadow-xl focus-within:shadow-[0_0_60px_color-mix(in_srgb,var(--brand-soft)_18%,transparent)] transition-shadow duration-700"
          )}
          >
            <AIPanel open={aiPanelOpen} onClose={onToggleAI} />
            {setupMode ? (
              <WritingSetup
                setupMode={setupMode}
                setSetupMode={setSetupMode}
                startCountdown={startCountdown}
                countdown={countdown}
                userSessions={[]}
                continueSession={onContinueSession}
                onSetPromptTitle={onSetPromptTitle}
              />
            ) : (
            <WritingEditor
              onKeyDown={(e) => {
                if (!e.metaKey && !e.ctrlKey && !e.altKey) {
                  keystrokeTrackerRef.current.record();
                }
                if ((sessionStatus === 'idle' || sessionStatus === 'paused') && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
                  handlePlayRef.current();
                }
              }}
            />
            )}
          </div>
        </div>

        <div style={{ gridColumn: '2', gridRow: '3', overflow: 'hidden' }}>
          <BottomStats
            compact={isCompact}
            onPlay={onPlay}
            onPause={onPause}
            onStop={onStop}
          />
        </div>

        <div style={{ gridColumn: '3', gridRow: '1 / 4', overflow: 'hidden' }}>
          <AnimatePresence>
            {lifeLogVisible && (
              <LifeLogPanel
                userId={userId}
                onContinueSession={onContinueSessionOrDoc}
                onClose={() => { if (!lifeLogPinned) setLifeLogVisible(false); }}
                activeTab={lifeLogTab}
                onTabChange={setLifeLogTab}
                pinned={lifeLogPinned}
                onTogglePin={() => setLifeLogPinned(!lifeLogPinned)}
                inGrid
                streakDays={streakDays}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
