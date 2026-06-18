import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { cn } from '../../../core/utils/utils';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useLanguage } from '../../../shared/i18n';
import { useWritingSessionContext } from '../contexts/WritingSessionContext';
import { Button } from '../../../shared/components/Button';

import { WritingHeader } from '../components/WritingHeader';
import { WritingEditor } from '../components/WritingEditor';
import { WritingSetup } from '../components/WritingSetup';
import { LifeLogPanel } from '../components/LifeLogPanel';
import { BottomStats } from '../components/BottomStats';
import { ConnectionStatusBanner } from '../components/ConnectionStatusBanner';

export function DesktopWritingLayout() {
  const { t } = useLanguage();
  const editorColRef = React.useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = React.useState(false);
  const { editorWidth, zenSeenOnce } = useWritingSettings();
  const reducedMotion = useReducedMotion();

  const {
    flow,
    actions,
    session,
    streakDays,
    handlePlayRef,
    keystrokeTrackerRef,
    showZen,
  } = useWritingSessionContext();

  const {
    setupMode,
    setSetupMode,
    startCountdown,
    countdown,
    totalDurationForDeadline,
  } = flow;

  const { onFinishClick } = useWritingSessionContext();

  const onNew = actions.handleNew;
  const onOpenLog = actions.handleOpen;
  const onPlay = actions.handlePlay;
  const onPause = actions.handlePause;
  const onContinueSession = actions.handleContinueDocument;
  const onSave = onFinishClick;
  const onStop = onFinishClick;

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

  const { lifeLogVisible, setLifeLogVisible, lifeLogTab, setLifeLogTab, lifeLogPinned, setLifeLogPinned } = useWritingSettings();

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={reducedMotion ? false : { opacity: 1 }}
      className="w-full transition-colors duration-1000"
    >
      <ConnectionStatusBanner showZen={showZen} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${showZen ? '0px' : '64px'} 1fr${lifeLogPinned && lifeLogVisible ? ' 380px' : ''}`,
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
        <div className="col-start-2 row-start-1 overflow-hidden">
          <WritingHeader
            totalDurationForDeadline={totalDurationForDeadline}
            onNew={() => void onNew()}
            onOpenLog={() => void onOpenLog()}
            onSave={() => void onSave()}
            onPlay={() => void onPlay()}
            onPause={() => void onPause()}
            onStop={() => void onStop()}
            saveStatus={session.saveStatus}
          />
        </div>

        <div ref={editorColRef} className="col-start-2 row-start-2 overflow-hidden relative flex flex-col justify-center">
          <AnimatePresence>
            {session.hasDraft && session.status === 'idle' && !setupMode && (
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
                    <Button onClick={() => void session.restoreDraft()} className="text-text-main font-medium hover:opacity-70 transition-opacity">
                      {t('draft_restore')}
                    </Button>
                    <Button onClick={() => void session.discardDraft()}
                      className="text-text-main/60 hover:text-text-main/60 transition-colors">
                      {t('draft_discard')}
                    </Button>
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
            {setupMode ? (
              <WritingSetup
                setupMode={setupMode}
                setSetupMode={setSetupMode}
                startCountdown={startCountdown}
                countdown={countdown}
                userSessions={[]}
                continueSession={(s) => void onContinueSession(s)}
                onSetPromptTitle={session.setTitle}
              />
            ) : (
            <WritingEditor
              onKeyDown={(e) => {
                if (!e.metaKey && !e.ctrlKey && !e.altKey) {
                  keystrokeTrackerRef.current.record();
                }
                if ((session.status === 'idle' || session.status === 'paused') && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
                  handlePlayRef.current();
                }
              }}
            />
            )}
          </div>
        </div>

        <div className="col-start-2 row-start-3 overflow-hidden">
          <BottomStats
            compact={isCompact}
            onPlay={() => void onPlay()}
            onPause={() => void onPause()}
            onStop={() => void onStop()}
          />
        </div>

        {lifeLogVisible && lifeLogPinned && (
          <div className="col-start-3 row-span-3 overflow-hidden">
            <LifeLogPanel
              userId={session.userId}
              onContinueSession={(s) => void actions.handleContinueSessionOrDoc(s)}
              onClose={() => setLifeLogVisible(false)}
              activeTab={lifeLogTab}
              onTabChange={setLifeLogTab}
              pinned={lifeLogPinned}
              onTogglePin={() => setLifeLogPinned(!lifeLogPinned)}
              inGrid={true}
              streakDays={streakDays}
            />
          </div>
        )}
      </div>

      <AnimatePresence>
        {lifeLogVisible && !lifeLogPinned && (
          <LifeLogPanel
            userId={session.userId}
            onContinueSession={(s) => void actions.handleContinueSessionOrDoc(s)}
            onClose={() => setLifeLogVisible(false)}
            activeTab={lifeLogTab}
            onTabChange={setLifeLogTab}
            pinned={lifeLogPinned}
            onTogglePin={() => setLifeLogPinned(!lifeLogPinned)}
            inGrid={false}
            streakDays={streakDays}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showZen && !zenSeenOnce && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-surface-card/60 backdrop-blur-xl text-xs text-text-main/70 pointer-events-none"
          >
            {t('zen_hint')}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
