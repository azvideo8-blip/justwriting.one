import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { UserProfile } from '../../../types';
import { GoalToast } from '../../../shared/components/GoalToast';
import { SeoHead } from '../../../shared/i18n/SeoHead';

import { WritingFinishModal } from '../components/WritingFinishModal';
import { ShortcutsModal } from '../components/ShortcutsModal';
import { FlowPulse } from '../../../core/theme/FlowPulse';
import { CancelConfirmModal } from '../../../shared/components/CancelConfirmModal';

import { MobileWriteScreen } from '../components/MobileWriteScreen';
import { MobileHomeScreen } from '../components/MobileHomeScreen';
import { MobileSessionSetupSheet } from '../components/MobileSessionSetupSheet';

import { useGuestWritingSession } from '../hooks/useGuestWritingSession';
import { useCloudWritingSession } from '../hooks/useCloudWritingSession';

import { WritingSessionProvider, useWritingSessionContext } from '../contexts/WritingSessionContext';
import { DesktopWritingLayout } from './DesktopWritingLayout';
import { useTimerStore } from '../store/useTimerStore';
import { useContentStore } from '../store/useContentStore';

export type { AnySessionReturn } from '../hooks/useWritingActions';

interface WritingViewProps {
  user: User | null;
  profile: UserProfile | null;
}

function AuthenticatedWritingPage({ user, profile }: { user: User; profile: UserProfile | null }) {
  const session = useCloudWritingSession(user, profile);
  return (
    <WritingSessionProvider session={session} profile={profile} user={user}>
      <WritingPageUI />
    </WritingSessionProvider>
  );
}

function GuestWritingPage() {
  const session = useGuestWritingSession();
  return (
    <WritingSessionProvider session={session} profile={null} user={null}>
      <WritingPageUI />
    </WritingSessionProvider>
  );
}

function WritingPageContent({ user, profile }: WritingViewProps) {
  if (user) {
    return <AuthenticatedWritingPage user={user} profile={profile} />;
  }
  return <GuestWritingPage />;
}

function WritingPageUI() {
  const {
    session,
    profile,
    flow,
    actions,
    lifeLogGroups,
    lifeLogSummary,
    refreshLifeLog,
    streakDays,
    streakForModal,
    isFinishModalOpen,
    setIsFinishModalOpen,
    isShortcutsModalOpen,
    setIsShortcutsModalOpen,
    devKpmStats,
    keystrokeTrackerRef,
    isMobile,
    onFinishClick,
    savedDocumentId,
  } = useWritingSessionContext();

  const {
    setSetupMode,
    setShowCancelConfirm,
  } = flow;

  const {
    handleSave,
    handlePlay,
    handlePause,
    handleNew,
    handleCancel,
    handleContinueSessionOrDoc,
  } = { ...actions, handleCancel: session.handleCancel };

  const sessionStatus = session.status;
  const tags = session.tags;
  const setTags = session.setTags;
  const labelId = session.labelId;
  const setLabelId = session.setLabelId;

  const mainContent = (() => {
    if (isMobile) {
      if (sessionStatus === 'idle')
        return (
          <MobileHomeScreen
            userId={session.userId}
            streakDays={streakDays}
            sessionGroups={lifeLogGroups}
            summary={lifeLogSummary}
            onStart={() => setSetupMode('selection')}
            onContinue={(s) => void handleContinueSessionOrDoc(s)}
            hasDraft={session.hasDraft}
            restoreDraft={() => void session.restoreDraft()}
            discardDraft={() => void session.discardDraft()}
            onRefresh={refreshLifeLog}
          />
        );
      return (
        <MobileWriteScreen
          onPlay={() => void handlePlay()}
          onPause={() => void handlePause()}
          onStop={() => void onFinishClick()}
          onNew={() => void handleNew()}
          saveStatus={session.saveStatus}
          keystrokeTrackerRef={keystrokeTrackerRef}
        />
      );
    }
    return <DesktopWritingLayout />;
  })();

  return (
    <>
      {mainContent}
      <MobileSessionSetupSheet
        setupMode={flow.setupMode}
        setSetupMode={setSetupMode}
        startCountdown={flow.startCountdown}
        countdown={flow.countdown}
      />
      <GoalToast visible={flow.goalToastVisible} type={flow.goalToastType} />
      <AnimatePresence>
        {flow.sessionStartFlash && (
          <motion.div
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="fixed inset-0 z-[var(--z-auth)] bg-text-main pointer-events-none"
          />
        )}
      </AnimatePresence>
      <CancelConfirmModal
        isOpen={flow.showCancelConfirm}
        onConfirm={() => { void handleCancel(); setShowCancelConfirm(false); }}
        onCancel={() => setShowCancelConfirm(false)}
      />
      <WritingFinishModal
        isOpen={isFinishModalOpen}
        tags={tags} setTags={setTags}
        labelId={labelId} setLabelId={setLabelId}
        labels={profile?.labels || []}
        onSave={handleSave}
        onCancel={() => {
          const currentStatus = useTimerStore.getState().status;
          const currentContent = useContentStore.getState().content;
          if (currentStatus === 'paused' && currentContent) {
            void handlePlay();
          }
          setIsFinishModalOpen(false);
        }}
        onSkipSave={() => setIsFinishModalOpen(false)}
        streakDays={streakForModal}
        sessionGroups={lifeLogGroups}
        savedDocumentId={savedDocumentId}
      />
      <FlowPulse isActive={sessionStatus === 'writing'} />
      {isShortcutsModalOpen && (
        <ShortcutsModal onClose={() => setIsShortcutsModalOpen(false)} />
      )}
      {import.meta.env.DEV && devKpmStats && (
        <div className="fixed bottom-2 left-2 text-label font-mono text-text-main/60 z-50 pointer-events-none">
          KPM {devKpmStats.kpm} · IKI {devKpmStats.ikiMedian}ms · CV {devKpmStats.ikiCv}
        </div>
      )}
    </>
  );
}

export function WritingPage({ user, profile }: WritingViewProps) {
  return (
    <>
      <SeoHead
        path="/"
        titleRu="justwriting — тихий редактор для свободного письма"
        titleEn="justwriting — a quiet editor for free writing"
        descriptionRu="Тихий редактор для свободного письма. Без отвлечений. Режим потока, шифрование, серия дней."
        descriptionEn="A quiet editor for free writing. No distractions. Stream mode, encryption, writing streaks."
      />
      <WritingPageContent user={user} profile={profile} />
    </>
  );
}
