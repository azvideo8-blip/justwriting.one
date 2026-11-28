import { AIPanelContent } from '../../features/ai/components/AIPanel';
import { SettingsPanelContent } from '../../features/settings/components/SettingsPanel';
import { useContentStore } from '../../features/writing/store/useContentStore';
import { useSessionMetaStore } from '../../features/writing/store/useSessionMetaStore';
import React, { useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { cn } from '../../core/utils/utils';
import { useWritingSettings } from '../../core/settings/WritingSettingsContext';
import { useLanguage } from '../../shared/i18n';
import { useWritingSessionContext } from '../../features/writing/contexts/WritingSessionContext';
import { Button } from '../../shared/components/Button';

import { WritingHeader } from '../../features/writing/components/WritingHeader';
import { WritingEditor } from '../../features/writing/components/WritingEditor';
import { WritingSetup } from '../../features/writing/components/WritingSetup';
import { LifeLogPanel } from '../../features/writing/components/LifeLogPanel';
import { BottomStats } from '../../features/writing/components/BottomStats';
import { DictationChrome } from '../../features/writing/components/DictationBar';
import { SessionGlow } from '../../features/writing/components/SessionGlow';
import { ReturnToWritingCard } from '../../features/writing/components/ReturnToWritingCard';
import { SyncUnsyncedBar } from '../../core/components/SyncUnsyncedBar';
import { CloudNotesBanner } from '../../features/writing/components/CloudNotesBanner';
import { DraftWriteAlertBar } from '../../features/writing/components/DraftWriteAlertBar';
import { useDraftWriteAlertStore } from '../../features/writing/store/useDraftWriteAlertStore';
import { StreakChip } from '../../features/writing/components/StreakChip';
import { OnThisDayCard } from '../../core/components/OnThisDayCard';
import { useHomeHint } from '../../features/writing/hooks/useHomeHint';
import { hasOnlyTouchPointer } from '../../shared/utils/touchPointer';
import { useStartOnFirstInput } from '../../features/writing/hooks/useStartOnFirstInput';
// Текст нужен только ИИ-панели: подписка здесь, а не в раскладке, иначе на
// каждое нажатие перерисовывалась вся раскладка с нижней панелью (EA-9).
export function LiveAIPanelContent() {
  const content = useContentStore(s => s.content);
  const setContent = useContentStore(s => s.setContent);
  // HA-1: та же заметка, что у диктовки (useDictation) — скрытую панель модели не отдаёт.
  const documentId = useSessionMetaStore(s => s.savedDocumentId);
  return <AIPanelContent content={content} onApplyContent={setContent} documentId={documentId} />;
}

/**
 * VIS: баннер отказа записи подписан на свой стор отдельным компонентом (как
 * ИИ-панель выше) — раскладка не перерисовывается от смены флага. Обёртка нужна
 * ради ширины поля письма и рисуется только когда баннер есть: пустой блок с
 * отступом сдвинул бы колонку навсегда.
 */
function LiveDraftWriteAlert({ editorWidth }: { editorWidth: number }) {
  const visible = useDraftWriteAlertStore(s => s.localWriteStuck);
  if (!visible) return null;
  return (
    <div
      className="shrink-0 self-center mb-2"
      style={{ width: editorWidth < 100 ? `${editorWidth}%` : '100%' }}
    >
      <DraftWriteAlertBar />
    </div>
  );
}

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
    streakFreezeUsed,
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

  // Одна подсказка за раз: «Продолжить», иначе «В этот день» (владелец 26.10).
  // Пока пишешь, ни той, ни другой.
  const homeIdle = !setupMode && session.status === 'idle' && !session.hasDraft;
  const { returnNote, dismissReturn, onThisDay } = useHomeHint(session.userId, homeIdle);

  const onNew = actions.handleNew;
  const onOpenLog = actions.handleOpen;
  const onPlay = actions.handlePlay;
  const onPause = actions.handlePause;
  const onContinueSession = actions.handleContinueDocument;
  const onSave = onFinishClick;
  const onStop = onFinishClick;

  const handleNew = useCallback(() => { void onNew(); }, [onNew]);
  const handleOpenLog = useCallback(() => { void onOpenLog(); }, [onOpenLog]);
  const handleSave = useCallback(() => { void onSave(); }, [onSave]);
  const handlePlay = useCallback(() => { void onPlay(); }, [onPlay]);
  const handlePause = useCallback(() => { void onPause(); }, [onPause]);
  const handleStop = useCallback(() => { void onStop(); }, [onStop]);

  // T-6: логика «первый символ начинает сессию» общая с телефоном.
  const recordKeystroke = useCallback(() => keystrokeTrackerRef.current.record(), [keystrokeTrackerRef]);
  const { handleEditorKeyDown, handleEditorInput } = useStartOnFirstInput({
    status: session.status,
    play: handlePlayRef,
    onKeystroke: recordKeystroke,
  });

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

  const { lifeLogVisible, setLifeLogVisible, lifeLogTab, setLifeLogTab, lifeLogPinned, setLifeLogPinned, silenceMode } = useWritingSettings();

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={reducedMotion ? false : { opacity: 1 }}
      className="w-full transition-colors duration-1000"
    >

      <div
        style={{
          display: 'grid',
          // DC-W5: колонка-спейсер не меняется в дзен — иначе каждый переход
          // сдвигает центрованный текст на 64 px вбок.
          gridTemplateColumns: `64px 1fr${lifeLogPinned && lifeLogVisible ? ' 380px' : ''}`,
          gridTemplateRows: '48px 1fr 64px',
          height: '100vh',
          width: '100vw',
          position: 'fixed',
          inset: 0,
          zIndex: 20,
          overflow: 'hidden',
        }}
      >
        <div className="col-start-2 row-start-1 overflow-hidden">
          <WritingHeader
            totalDurationForDeadline={totalDurationForDeadline}
            onNew={handleNew}
            onOpenLog={handleOpenLog}
            onSave={handleSave}
            onPlay={handlePlay}
            onPause={handlePause}
            onStop={handleStop}
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
                  <div className="flex flex-col leading-tight">
                    <span>{t('draft_restore_prompt')}</span>
                    {/* N1-5: срок гостевого черновика (`GUEST_DRAFT_TTL_MS`) — только гостю. */}
                    {session.isGuest && (
                      <span className="text-xs text-text-main/45">{t('draft_restore_guest_ttl')}</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => void session.restoreDraft()} className="text-text-main font-medium hover:opacity-70 transition-opacity">
                      {t('draft_restore')}
                    </Button>
                    <Button onClick={() => void session.discardDraft()}
                      className="text-text-main/60 hover:text-text-main transition-colors">
                      {t('draft_discard')}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <SyncUnsyncedBar
            userId={session.isGuest ? null : session.userId}
            className="shrink-0 mx-auto mb-2"
          />
          <CloudNotesBanner className="shrink-0 mx-auto mb-2 flex items-center gap-3 rounded-xl border border-text-main/10 bg-surface-card/90 px-4 py-2 text-sm text-text-main/70" />
          <LiveDraftWriteAlert editorWidth={editorWidth} />
          {/* Владелец 30.10: серия и подсказка («Продолжить» или «В этот день») —
              одной тихой строкой по ширине поля письма, а не стопкой плашек
              посреди экрана. Слева серия, справа подсказка. */}
          {!setupMode && session.status === 'idle' && (
            <div
              data-testid="home-status-row"
              className="shrink-0 self-center flex items-center justify-between gap-4 px-4 text-[13px] text-text-main/60"
              style={{ width: editorWidth < 100 ? `${editorWidth}%` : '100%' }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <StreakChip days={streakDays} className="border-0 bg-transparent px-0 py-0 text-[13px] font-medium text-text-main/70" />
                {streakFreezeUsed && (
                  <span className="text-xs text-text-main/60" data-testid="streak-freeze-note">
                    {t('home_streak_frozen')}
                  </span>
                )}
              </div>
              <ReturnToWritingCard
                note={returnNote}
                hidden={Boolean(setupMode) || session.hasDraft}
                className="flex items-center gap-1 text-[13px] text-text-main/60"
                onContinue={(doc) => void actions.handleContinueDocument(doc)}
                onDismiss={dismissReturn}
              />
              {/* «В этот день» — строкой и без текста заметки (экран может быть
                  открыт при ком-то); только когда «Продолжить» нет. */}
              {onThisDay && homeIdle && (
                <div className="min-w-0 max-w-md">
                  <OnThisDayCard
                    sessions={[onThisDay]}
                    userId={session.userId}
                    showExcerpt={false}
                    compact
                    onOpen={(s) => void actions.handleContinueSessionOrDoc(s)}
                  />
                </div>
              )}
            </div>
          )}
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
            <>
              <WritingEditor
                onKeyDown={handleEditorKeyDown}
                onInput={handleEditorInput}
              />
              {/* Панель записи — поверх низа редактора, а не под ним: редактор
                  занимает всю высоту блока с overflow-hidden, и панель «после»
                  него оказывалась за обрезанным краем — человек не видел записи
                  вовсе (0.9.34, Яндекс на Mac). */}
              <div className="absolute inset-x-0 bottom-0 z-20">
                <DictationChrome />
              </div>
            </>
            )}
            <SessionGlow
              phase={
                session.status === 'writing'
                  ? flow.sessionStartFlash ? 'breath' : 'ring'
                  : 'off'
              }
            />
          </div>
        </div>

        <div className="col-start-2 row-start-3 overflow-hidden relative z-10">
          <BottomStats
            compact={isCompact}
            saveStatus={session.saveStatus}
            saveErrorKind={session.saveErrorKind}
            onPlay={handlePlay}
            onPause={handlePause}
            onStop={handleStop}
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
              renderAiContent={() => <LiveAIPanelContent />}
              renderSettingsContent={() => <SettingsPanelContent userId={session.userId} />}
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
            renderAiContent={() => <LiveAIPanelContent />}
            renderSettingsContent={() => <SettingsPanelContent userId={session.userId} />}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showZen && !zenSeenOnce && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[var(--z-panel)] px-4 py-2 rounded-xl bg-surface-card/60 backdrop-blur-xl text-xs text-text-main/70 pointer-events-none"
          >
            {hasOnlyTouchPointer()
              ? t(silenceMode ? 'zen_hint_silence_touch' : 'zen_hint_touch')
              : t(silenceMode ? 'zen_hint_silence' : 'zen_hint')}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
