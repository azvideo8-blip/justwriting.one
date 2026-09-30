import React from 'react';

import type { AppUser } from '../../core/auth/types';
import { UserProfile } from '../../types';
import { GoalToast } from '../../shared/components/GoalToast';
import { SeoHead } from '../../shared/i18n/SeoHead';

import { WritingFinishModal } from '../../features/writing/components/WritingFinishModal';
import { ShortcutsModal } from '../../features/writing/components/ShortcutsModal';
import { FlowPulse } from '../../core/theme/FlowPulse';
import { CancelConfirmModal } from '../../shared/components/CancelConfirmModal';

import { MobileWriteScreen } from '../../features/writing/components/MobileWriteScreen';
import { MobileHomeScreen } from '../../features/writing/components/MobileHomeScreen';
import { MobileSessionSetupSheet } from '../../features/writing/components/MobileSessionSetupSheet';

import { useGuestWritingSession } from '../../features/writing/hooks/useGuestWritingSession';
import { useCloudWritingSession } from '../../features/writing/hooks/useCloudWritingSession';

import { WritingSessionProvider, useWritingSessionContext } from '../../features/writing/contexts/WritingSessionContext';
import { useWritingSettings } from '../../core/settings/WritingSettingsContext';
import { DesktopWritingLayout } from './DesktopWritingLayout';
import { LiveAIPanel } from './LiveAIPanel';
import { useTimerStore } from '../../features/writing/store/useTimerStore';
import { useContentStore } from '../../features/writing/store/useContentStore';

export type { AnySessionReturn } from '../../features/writing/hooks/useWritingActions';

interface WritingViewProps {
  user: AppUser | null;
  profile: UserProfile | null;
}

function AuthenticatedWritingPage({ user, profile }: { user: AppUser; profile: UserProfile | null }) {
  const session = useCloudWritingSession(user, profile);
  const ui = React.useMemo(() => <WritingPageUI />, []);
  return (
    <WritingSessionProvider session={session} profile={profile} user={user}>
      {ui}
    </WritingSessionProvider>
  );
}

function GuestWritingPage() {
  const session = useGuestWritingSession();
  const ui = React.useMemo(() => <WritingPageUI />, []);
  return (
    <WritingSessionProvider session={session} profile={null} user={null}>
      {ui}
    </WritingSessionProvider>
  );
}

function WritingPageContent({ user, profile }: WritingViewProps) {
  if (user) {
    return <AuthenticatedWritingPage user={user} profile={profile} />;
  }
  return <GuestWritingPage />;
}

// memo: WritingPageUI без пропсов, всё берёт из контекста. Без memo он
// перерисовывался вместе с хуком сессии на каждое нажатие (EA-9).
const WritingPageUI = React.memo(function WritingPageUI() {
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

  const { silenceMode } = useWritingSettings();

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
          saveErrorKind={session.saveErrorKind}
          keystrokeTrackerRef={keystrokeTrackerRef}
          renderAiPanel={(open, onClose) => <LiveAIPanel open={open} onClose={onClose} />}
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
      <FlowPulse isActive={sessionStatus === 'writing'} silenceMode={silenceMode} />
      {isShortcutsModalOpen && (
        <ShortcutsModal onClose={() => setIsShortcutsModalOpen(false)} />
      )}
      {import.meta.env.DEV && devKpmStats && (
        <div className="fixed bottom-2 left-2 text-label font-mono text-text-main/60 z-[var(--z-panel)] pointer-events-none">
          KPM {devKpmStats.kpm} · IKI {devKpmStats.ikiMedian}ms · CV {devKpmStats.ikiCv}
        </div>
      )}
    </>
  );
});

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
