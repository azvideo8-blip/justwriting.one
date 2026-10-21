import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useShallow } from 'zustand/react/shallow';
import { useWritingSettings } from '../../../core/settings/WritingSettingsContext';
import { useLanguage } from '../../../shared/i18n';
import { useSettings } from '../../../core/settings/SettingsContext';
import { useKeyboardState } from '../../../shared/hooks/useKeyboardState';
import { useStartOnFirstInput } from '../hooks/useStartOnFirstInput';
import { formatTime } from '../../../core/utils/formatTime';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useSaveMomentStore, SAVE_MOMENT_MS, SAVE_WARNING_MS } from '../store/useSaveMomentStore';
import { useCountUp } from '../../../shared/hooks/useCountUp';
import { MobileFocusScreen } from './MobileFocusScreen';
import { MobileWriteToolbar } from './MobileWriteToolbar';
import { getFontStack } from '../utils/fontStack';
import { sessionClockSeconds } from '../utils/sessionModeLabels';
import { KeystrokeTracker } from '../utils/keystrokeTracker';
import { cn } from '../../../core/utils/utils';
import { SlidersHorizontal } from 'lucide-react';
import { IconButton } from '../../../shared/components/IconButton';
import { SaveStatus } from './SaveStatus';
import { useAutoHideCursor } from '../hooks/useAutoHideCursor';
import type { SessionType } from '../store/types';

// Ревью 0.9.39: жетон всегда говорил «Поток», хотя первая буква запускает
// режим, оставшийся от прошлой сессии (таймер, цель по словам, дедлайн).
interface MobileWriteScreenProps {
  onPlay: () => void;
  onStop: () => void;
  saveStatus?: string;
  saveErrorKind?: 'quota' | 'unknown' | null;
  keystrokeTrackerRef?: React.RefObject<KeystrokeTracker>;
  renderAiPanel?: (open: boolean, onClose: () => void) => React.ReactNode;
  /** MR-6: «Писать» открывает редактор — экран-заглушка больше не нужен. */
  status?: string;
  streakDays?: number;
  /** Режим, с которым стартует сессия по первой букве (может остаться от прошлой). */
  sessionType?: SessionType;
  onOpenSetup?: () => void;
  hasDraft?: boolean;
  /** MQ-3: текст черновика уже стоит в редакторе (подставлен при открытии). */
  draftInEditor?: boolean;
  restoreDraft?: () => void;
  discardDraft?: () => void;
  /** MQ-3: «Убрать» — стереть и черновик, и текст в редакторе. */
  removeDraft?: () => void;
}

export function MobileWriteScreen({
  onPlay, onStop, saveStatus, saveErrorKind, keystrokeTrackerRef, renderAiPanel,
  status: statusProp, streakDays = 0, sessionType = 'free', onOpenSetup, hasDraft, draftInEditor, restoreDraft, discardDraft, removeDraft,
}: MobileWriteScreenProps) {
  const { t, tp, language } = useLanguage();
  const { openSettings } = useSettings();
  const { content, setContent, title, setTitle, wordCount } = useContentStore(
    useShallow(s => ({
      content: s.content,
      setContent: s.setContent,
      title: s.title,
      setTitle: s.setTitle,
      wordCount: s.wordCount,
    }))
  );
  const { status, seconds, timerDuration, sessionStartSeconds, sessionStartWords } = useTimerStore(
    useShallow(s => ({
      status: s.status,
      seconds: s.seconds,
      timerDuration: s.timerDuration,
      sessionStartSeconds: s.sessionStartSeconds,
      sessionStartWords: s.sessionStartWords,
    }))
  );
  // MR-6: первый символ начинает запись — тот же закон, что на десктопе.
  const playRef = useRef(onPlay);
  // MR-11: ref пишется в эффекте, а не во время рендера (react-hooks/refs).
  useEffect(() => { playRef.current = onPlay; }, [onPlay]);
  const isIdleState = (statusProp ?? status) === 'idle';
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const { handleEditorKeyDown: startOnKey, handleEditorInput: startOnInput } = useStartOnFirstInput({
    status: statusProp ?? status,
    play: playRef,
    onKeystroke: () => keystrokeTrackerRef?.current?.record(),
  });

  const { fontFamily, fontSize, isZenActive, zenModeEnabled, streamMode, toggleStreamMode, autoHideCursor, aiPanelOpen, setAiPanelOpen } = useWritingSettings();

  const sessionSeconds = Math.max(0, seconds - sessionStartSeconds);
  const sessionWords = Math.max(0, wordCount - sessionStartWords);
  const clockSeconds = sessionClockSeconds(sessionType, timerDuration, sessionSeconds);

  const isRunning = status === 'writing';
  const isPaused = status === 'paused';
  const showZen = isZenActive && zenModeEnabled;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    startOnKey(e);

    if (streamMode) {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'c' || e.key === 'v')) {
        e.preventDefault();
      }
    }
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    startOnInput(e);
  };

  const handleBeforeInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if (!streamMode) return;
    const inputEvent = e.nativeEvent as InputEvent;
    const inputType = inputEvent.inputType || '';
    if (inputType.includes('delete') || inputType.includes('cut') || inputType.includes('paste')) {
      e.preventDefault();
    }
  };

  const intensityRef = useRef(0);
  const glowBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const decay = setInterval(() => {
      intensityRef.current = Math.max(0, intensityRef.current - 0.05);
      const node = glowBarRef.current;
      if (node) {
        node.style.opacity = String(status === 'writing' ? 0.3 + intensityRef.current * 0.55 : 0);
        // SA-10: transform вместо margin-left — без Layout каждые 200 мс. 20 % контейнера = 33 % ширины полосы (60 %).
        node.style.transform = `translateX(${(intensityRef.current * 100) / 3}%)`;
      }
    }, 200);
    return () => clearInterval(decay);
  }, [status]);

  const handleType = () => {
    if (status === 'writing') {
      intensityRef.current = Math.min(1, intensityRef.current + 0.2);
    }
  };

  const [focusMode, setFocusMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  // MQ-15 (N-15): «маяк» (lighthouse-pulse) снят на телефоне: тень на 28 px обрезалась overflow-hidden
  // целиком, а перерисовывалась каждые 1,2 с впустую.

  useAutoHideCursor(editorAreaRef, autoHideCursor);
  const swipeTouchStartY = useRef<number>(0);
  const swipeTouchStartX = useRef<number>(0);

  const prevMilestoneRef = useRef(0);

  useEffect(() => {
    const sessionWords = wordCount - sessionStartWords;
    const milestone = Math.floor(sessionWords / 100);
    if (milestone > prevMilestoneRef.current && milestone > 0) {
      prevMilestoneRef.current = milestone;
      navigator.vibrate?.(12);
    }
  }, [wordCount, sessionStartWords]);

  useEffect(() => {
    if (status === 'idle') {
      prevMilestoneRef.current = 0;
    }
  }, [status]);


  const handleEditorTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    swipeTouchStartY.current = touch.clientY;
    swipeTouchStartX.current = touch.clientX;
  };

  const handleEditorTouchEnd = (e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    const deltaY = touch.clientY - swipeTouchStartY.current;
    const deltaX = Math.abs(touch.clientX - swipeTouchStartX.current);
    if (deltaY > 60 && deltaX < 40 && isRunning) {
      setFocusMode(true);
    }
  };

  const fontFamilyStr = getFontStack(fontFamily);

  // Клавиатура поднимает столбец над собой; без неё — над нижней панелью.
  // MC-2: когда панель прячется, её высоту прибавлять не за что, и столбец
  // встаёт на 8 px над краем экрана (или над клавиатурой, если она легла
  // поверх вьюпорта, а не сожгла его).
  const keyboardState = useKeyboardState();

  // MC-4: момент после «Сохранить» — тихая строка в шапке письма вместо
  // всплывающего тоста, а «ещё не в облаке» — та же строка предупреждением
  // (3 с вместо 1,2 с): оно обязано остаться видимым.
  const saveMoment = useSaveMomentStore(s => s.moment);
  const reducedMotion = useReducedMotion();
  // SA-10: серия не считается с нуля при каждом заходе на вкладку — только растёт; reduced motion — без счёта.
  const streakShown = useCountUp(streakDays, reducedMotion ? 0 : 300, streakDays);
  useEffect(() => {
    if (!saveMoment) return;
    const ms = saveMoment.warningText !== null ? SAVE_WARNING_MS : SAVE_MOMENT_MS;
    const timer = setTimeout(() => { useSaveMomentStore.getState().clear(); }, ms);
    return () => clearTimeout(timer);
  }, [saveMoment]);
  // Окно завершения получает серу после сохранения (`streakForModal`), экран
  // письма — до: разница и есть «серия выросла этой записью».
  const streakGrew = saveMoment !== null && saveMoment.streakDays !== null
    && saveMoment.streakDays > streakDays;
  const saveMomentLine = saveMoment === null ? '' : saveMoment.warningText ?? [
    `${t('save_moment_saved')} · ${tp('archive_word_count', saveMoment.words)}`,
    streakGrew
      ? `${t('save_moment_streak')} ${saveMoment.streakDays ?? streakDays} ${tp('home_streak_days', saveMoment.streakDays ?? streakDays)}`
      : '',
  ].filter(Boolean).join(' · ');

  // MF-2: низ поля освобождается под весь столбец панелей (запись + панель
  // письма), а не под клавиатуру: раньше строка каретки уходила под столбец.
  // Меряется геометрией — так не важно, клавиатура это, вкладки или диктовка.
  const columnRef = useRef<HTMLDivElement>(null);
  const [bottomPad, setBottomPad] = useState(120);
  useLayoutEffect(() => {
    const column = columnRef.current;
    const area = editorAreaRef.current;
    if (!column || !area) return;
    const measure = () => {
      const pad = Math.max(0, area.getBoundingClientRect().bottom - column.getBoundingClientRect().top) + 16;
      setBottomPad(prev => (prev === pad ? prev : pad));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(column);
    ro.observe(area);
    return () => ro.disconnect();
  }, [keyboardState.up, keyboardState.overlay]);

  // MF-2: строка, которую печатают (или диктуют) в конце, всегда над столбцом.
  // Браузер докручивает каретку только до края поля, а край — под панелью.
  // ponytail: только каретка в конце; правка в середине под панелью — через зеркало, если понадобится.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (ta && ta.selectionEnd === ta.value.length) ta.scrollTop = ta.scrollHeight;
  }, [bottomPad, content]);

  const toolbarStackStyle: React.CSSProperties = keyboardState.up
    ? { bottom: `${keyboardState.overlay + 8}px` }
    : { bottom: 'calc(env(safe-area-inset-bottom, 16px) + var(--bottom-nav-height, 72px))' };

  return (
    <>
      {/* not-a-modal: fullscreen mobile screen */}
      <div className="fixed inset-0 bg-surface-base flex flex-col z-30">

      {/* SA-10: шапка и строка дзена — в одном слоте 44 px, кроссфейд 150 мс:
          раньше шапка уходила 0,3 с, пока в колонке уже стояла строка дзена, и текст дёргался. */}
      {/* U-15: фон и граница шапки — как у шапки письма на десктопе. */}
      <div className="shrink-0 pt-[env(safe-area-inset-top,0px)] bg-surface-card/50 border-b border-border-subtle">
      <div className="relative h-11">
      {/* MQ-15 (N-9): шапка проступает после дзена с нуля — не поверх ещё гаснущей строки дзена. */}
      <AnimatePresence initial={false}>
        {!showZen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 flex items-center justify-between px-5 gap-3"
          >
            {saveMoment !== null ? (
              /* MC-4: на 1,2 с (или 3 с у предупреждения) шапка письма говорит
                 «Записано · 36 слов» вместо всего остального. */
              <span
                role="status"
                data-testid="save-moment"
                className={cn(
                  'flex-1 truncate text-[13px] font-medium tabular-nums',
                  saveMoment.warningText !== null ? 'text-[var(--accent-warning)]' : 'text-[var(--accent-success)]',
                )}
              >
                {saveMomentLine}
              </span>
            ) : isIdleState ? (
              streakDays >= 1 ? (
                <div className="flex items-center gap-1.5 py-1 px-3 rounded-full border border-[var(--border-light)] bg-[var(--surface-card)]">
                  <span className="text-[13px] font-medium text-[var(--text-main)] tabular-nums">
                    {streakShown} {tp('home_streak_days', streakDays)}
                  </span>
                </div>
              ) : <span className="min-w-11" aria-hidden="true" />
            ) : (
            /* U-2, U-17: время — Inter tabular-nums без плашки и свечения, как на десктопе;
               точка остаётся только сигналом паузы. */
            <div className="flex items-center gap-1.5">
              {isPaused && <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-warning)]" />}
              <span data-testid="session-time" className="text-[15px] font-medium text-text-main tabular-nums">
                {formatTime(clockSeconds)}
              </span>
            </div>
            )}

            {/* MQ-4: статус сохранения стоит слева, в одном слоте со временем, а не после «Aa»:
                отдельный блок min-w-60 справа выталкивал «Aa» с края и сам уезжал за экран. */}
            {/* U-16: «сохраняю / сохранено» — значком, как на десктопе (SaveStatus);
                ошибка и «только на устройстве» — текстом: на телефоне нет наведения. */}
            {/* U-16: «сохраняю / сохранено» — значком, как на десктопке (SaveStatus);
                ошибка и «только на устройстве» — текстом: на телефоне нет наведения.
                B-4: на idle компонент остаётся смонтированным и прячется сам, иначе
                переход saved→idle снимал иконку вразрез с затуханием, а новая копия
                при смене шапки на строку дзена врет «Ещё не сохранялось». */}
            {saveMoment === null && (saveStatus === 'saving' || saveStatus === 'saved' || saveStatus === 'idle') && (
              <SaveStatus saveStatus={saveStatus} saveErrorKind={saveErrorKind} hideWhenIdle />
            )}
            {saveMoment === null && (saveStatus === 'error' || saveStatus === 'cloud-stale') && (
              <span data-testid="save-status-text" className="max-w-[40%] shrink-0 truncate text-[12px] tabular-nums">
                {saveStatus === 'cloud-stale'
                  ? <span className="text-[var(--accent-warning)]">{t('editor_cloud_stale')}</span>
                  : <span className="text-[var(--accent-danger)]">{saveErrorKind === 'quota' ? t('editor_error_quota') : t('editor_error_save')}</span>}
              </span>
            )}

            {saveMoment === null && (isIdleState ? (
              /* MC-1: дата словами («Среда, 14 октября») — сокращённое «ср»
                 читалось как часть интерфейса, а не как день. */
              <span className="flex-1 text-center text-[13px] font-medium text-text-main/60">
                {(() => {
                  const label = new Date().toLocaleDateString(language === 'en' ? 'en-US' : 'ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
                  return label.charAt(0).toUpperCase() + label.slice(1);
                })()}
              </span>
            ) : (
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('topbar_title_placeholder')}
              aria-label={t('topbar_title_placeholder')}
              inputMode="text"
              enterKeyHint="done"
              className="min-w-0 flex-1 bg-transparent border-none outline-none text-[15px] font-medium text-text-main/60 focus:text-text-main text-left"
            />
            ))}

            {/* MR-5: настройки редактора живут в редакторе — справа. U-15: значок
                SlidersHorizontal без рамки, как на десктопе; цель 44 px. */}
            <IconButton
              onClick={() => openSettings()}
              label={t('settings_title')}
              icon={<SlidersHorizontal size={16} />}
              className="w-11 h-11 shrink-0 -mr-2"
            />

          </motion.div>
        )}
      </AnimatePresence>

      {/* MR-7: в дзене шапка сворачивается в одну строку — время, слова и
      статус сохранения. Раньше в дзене не было ни чего, и человек терял счёт. */}
      <AnimatePresence>
      {showZen && (
        <motion.div
          key="zen-row"
          data-testid="zen-header-row"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="absolute inset-0 flex items-center px-5 gap-3"
        >
          <span className="text-[12px] tabular-nums text-text-main/60 truncate">
            {formatTime(clockSeconds)}
            {' · '}
            {sessionWords} {tp('writing_words', sessionWords)}
          </span>
          <span className="flex-1" />
          {(saveStatus === 'saving' || saveStatus === 'saved' || saveStatus === 'idle') && <SaveStatus saveStatus={saveStatus} saveErrorKind={saveErrorKind} hideWhenIdle />}
          {(saveStatus === 'error' || saveStatus === 'cloud-stale') && (
            <span className="text-[12px] tabular-nums shrink-0">
              {saveStatus === 'cloud-stale'
                ? <span className="text-[var(--accent-warning)]">{t('editor_cloud_stale')}</span>
                : <span className="text-[var(--accent-danger)]">{t('editor_error_save')}</span>}
            </span>
          )}
        </motion.div>
      )}
      </AnimatePresence>
      </div>
      </div>

      {/* MC-1: второй строки в idle больше нет — токен режима уехал в панель
        письма. Здесь остаются только баннер черновика и его подтверждение. */}
      {!showZen && isIdleState && (hasDraft || discardConfirm) && (
        <div className="px-5 pb-2 flex flex-col gap-2">
          {hasDraft && (
            /* MQ-3: текст в две строки без обрезки, кнопки 44 px. Если черновик уже в
               редакторе, «Восстановить» нечего делать — остаётся только «Убрать». */
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border-light)] bg-[var(--surface-card)] px-3 py-1">
              <span className="flex-1 min-w-0 text-[13px] leading-snug text-text-main/60">
                {draftInEditor ? t('draft_restored') : t('draft_restore_prompt')}
              </span>
              {!draftInEditor && (
                <button type="button" onClick={() => restoreDraft?.()} className="press min-h-11 px-3 rounded-lg text-[13px] font-medium text-text-main">
                  {t('draft_restore')}
                </button>
              )}
              <button type="button" onClick={() => setDiscardConfirm(true)} className="press min-h-11 px-3 rounded-lg text-[13px] font-medium text-text-main/60">
                {draftInEditor ? t('draft_remove') : t('draft_discard')}
              </button>
            </div>
          )}
          {discardConfirm && (
            <div role="dialog" aria-modal="true" aria-labelledby="discard-draft-title" className="rounded-xl border border-[var(--border-light)] bg-surface-popup p-3 space-y-2">
              <span id="discard-draft-title" className="block text-[13px] text-[var(--text-main)]">{t('draft_discard_confirm')}</span>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setDiscardConfirm(false)} className="min-h-11 px-3 rounded-lg text-[13px] text-text-main/60">{t('common_cancel')}</button>
                <button type="button" onClick={() => { setDiscardConfirm(false); (draftInEditor ? removeDraft : discardDraft)?.(); }} className="min-h-11 px-3 rounded-lg text-[13px] font-semibold text-[var(--accent-danger)]">{t('draft_discard')}</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div
        ref={editorAreaRef}
        className="flex-1 overflow-hidden relative"
        onTouchStart={handleEditorTouchStart}
        onTouchEnd={handleEditorTouchEnd}
      >
        {/* MC-4: сохранённый текст уходит мягко — призрак гаснет за 200 мс с
            размытием в 2 px (при `prefers-reduced-motion` — только прозрачность
            и 120 мс). */}
        <AnimatePresence>
          {saveMoment !== null && saveMoment.text !== '' && content === '' && (
            <motion.p
              key={saveMoment.id}
              aria-hidden="true"
              initial={{ opacity: 1, filter: 'blur(0px)' }}
              animate={{ opacity: 0, filter: reducedMotion ? 'blur(0px)' : 'blur(2px)' }}
              exit={{ opacity: 0 }}
              transition={{ duration: reducedMotion ? 0.12 : 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="pointer-events-none absolute inset-x-6 top-4 whitespace-pre-wrap text-pretty leading-[1.7] text-[var(--text-main)]"
              style={{ fontFamily: fontFamilyStr, fontSize: fontSize || 18 }}
            >
              {saveMoment.text}
            </motion.p>
          )}
        </AnimatePresence>
        <textarea
          ref={textareaRef}
          dir="auto"
          value={content}
          onChange={e => { setContent(e.target.value); handleType(); }}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onBeforeInput={handleBeforeInput}
          onCut={e => { if (streamMode) e.preventDefault(); }}
          onCopy={e => { if (streamMode) e.preventDefault(); }}
          onPaste={e => { if (streamMode) e.preventDefault(); }}
          placeholder={t('writing_placeholder_mobile')}
          className="placeholder:text-text-main/40"
          inputMode="text"
          style={{
            width: '100%',
            height: '100%',
            padding: `16px 24px ${bottomPad}px`,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontFamily: fontFamilyStr,
            fontSize: fontSize || 18,
            lineHeight: 1.7,
            color: 'var(--text-main)',
            WebkitOverflowScrolling: 'touch',
          }}
        />

        <div className="absolute left-0 right-0 bottom-0 h-0.5 pointer-events-none overflow-hidden">
          <div
            ref={glowBarRef}
            className={cn(
              "h-full w-[60%] ml-[20%] transition-[opacity,transform] duration-300 ease-[cubic-bezier(.4,.2,.2,1)] blur-[1px] bg-[linear-gradient(90deg,transparent,var(--flow-pulse-color,var(--brand-primary))_50%,transparent)]",
              isRunning ? "opacity-30" : "opacity-0"
            )}
          />
        </div>
      </div>

      {/* MB-5/MF-4: столбец над нижней панелью. С MF-4 запись идёт в самой
          панели письма — отдельной карточки записи на телефоне нет. */}
      <div ref={columnRef} data-write-column className="absolute left-4 right-4 z-40 flex flex-col gap-2" style={toolbarStackStyle}>
        {/* MB-2: в дзене панель остаётся — «Стоп», микрофон и пауза должны быть
            достижимы одним касанием. Прячем только статистику. */}
        <MobileWriteToolbar
          onStop={onStop}
          streamMode={streamMode}
          onToggleStreamMode={toggleStreamMode}
          onOpenSetup={onOpenSetup}
          sessionType={sessionType}
          hideStats={showZen}
        />
      </div>

      <AnimatePresence>
        {focusMode && (
          <MobileFocusScreen onExit={() => setFocusMode(false)} />
        )}
      </AnimatePresence>

      {renderAiPanel ? renderAiPanel(aiPanelOpen, () => setAiPanelOpen(false)) : null}
    </div>
    </>
  );
}
