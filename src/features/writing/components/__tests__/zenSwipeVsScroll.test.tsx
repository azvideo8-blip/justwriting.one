// Видео владельца 19.11: листаешь длинную заметку вверх (палец идёт вниз) —
// экран прыгает в самый верх. Это был не скролл, а жест «свайп вниз → дзен»:
// он срабатывал посреди текста. В дзене зеркально: листать вниз = «свайп вверх → выход».
// Жест — только когда листать в эту сторону уже некуда.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MobileWriteScreen } from '../MobileWriteScreen';
import { MobileFocusScreen } from '../MobileFocusScreen';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: false,
    zenModeEnabled: false,
    editorWidth: 'normal',
    zenSeenOnce: true,
    fontFamily: 'Inter',
    fontSize: 18,
    streamMode: false,
    toggleStreamMode: vi.fn(),
    autoHideCursor: false,
    aiPanelOpen: false,
    setAiPanelOpen: vi.fn(),
    lifeLogVisible: false,
    headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../../../../core/settings/SettingsContext', () => ({
  useSettings: () => ({ openSettings: vi.fn() }),
}));
vi.mock('../../../../features/writing/contexts/WritingSessionContext', () => ({
  useWritingSessionContext: () => ({
    flow: { setupMode: 'none', openHelp: false, setOpenHelp: vi.fn() },
    actions: {},
    session: { saveStatus: 'saved', saveErrorKind: null },
    streakDays: 0,
    handlePlayRef: { current: null },
    keystrokeTrackerRef: { current: null },
    showZen: false,
    reducedMotion: true,
  }),
}));
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({ status: 'synced', pendingCount: 0 }),
}));
vi.mock('../../../../shared/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: () => ({ isVaultUnlocked: true, encryptionMode: 'none' }),
  useVaultStatus: () => ({ isVaultActive: false, isVaultUnlocked: true }),
}));

function renderScreen(overrides: Partial<ComponentProps<typeof MobileWriteScreen>> = {}) {
  return render(
    <MobileWriteScreen
      onPlay={vi.fn()}
      onStop={vi.fn()}
      status="idle"
      streakDays={0}
      sessionType="free"
      onOpenSetup={vi.fn()}
      {...overrides}
    />,
  );
}

function run(sessionType: string, timerDuration: number, seconds: number) {
  useTimerStore.setState({ status: 'writing', sessionType, timerDuration, seconds, sessionStartSeconds: 0, sessionStartWords: 0, wordGoal: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
}

const areas = () => Array.from(document.querySelectorAll('textarea'));

function scrollPos(el: HTMLElement, top: number, height = 3000, client = 500) {
  Object.defineProperty(el, 'scrollTop', { configurable: true, value: top });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: height });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: client });
}

function swipe(target: Element, fromY: number, toY: number) {
  fireEvent.touchStart(target, { touches: [{ clientX: 100, clientY: fromY }] });
  fireEvent.touchEnd(target, { changedTouches: [{ clientX: 100, clientY: toY }] });
}

describe('свайп дзена не перехватывает прокрутку текста', () => {
  beforeEach(() => {
    cleanup();
    useContentStore.setState({ content: 'длинная заметка\n'.repeat(300) });
    run('free', 0, 120);
  });

  it('посреди текста палец вниз — это прокрутка, дзен не открывается', () => {
    renderScreen({ status: 'writing' });
    const ta = areas()[0]!;
    scrollPos(ta, 1200);
    swipe(ta, 200, 400);
    expect(areas()).toHaveLength(1);
  });

  it('в самом верху палец вниз — дзен открывается, как раньше', () => {
    renderScreen({ status: 'writing' });
    const ta = areas()[0]!;
    scrollPos(ta, 0);
    swipe(ta, 200, 400);
    expect(areas()).toHaveLength(2);
  });

  it('в дзене посреди текста палец вверх — прокрутка, выхода нет; внизу — выход', () => {
    const onExit = vi.fn();
    render(<MobileFocusScreen onExit={onExit} />);
    const zen = areas()[0]!;
    scrollPos(zen, 1200);
    swipe(zen, 400, 200);
    expect(onExit).not.toHaveBeenCalled();
    scrollPos(zen, 2500);
    swipe(zen, 400, 200);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
