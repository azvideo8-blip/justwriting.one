// B-4 (0.10.2): SaveStatus монтировался только в состояниях saving/saved.
// 1) При смене шапки на строку дзена (и при любом перемонтировании в состоянии
//    «saved») новая копия стартовала с savedAt=null → aria «Ещё не сохранялось»,
//    хотя заметка уже сохранена.
// 2) Переход saved→idle снимал иконку через 1 с и обрывал затухание 900+700 мс.
// Фикс: время и вспышка ставятся при монтировании из входящего статуса, а шапка
// держит компонент смонтированным и на idle — SaveStatus сам прячется, когда
// показывать уже нечего (после проигранного затухания).
// Мутации: убрать инициализацию savedAt на маунте → кейс 1; вернуть условный
// монтаж в шапке → кейс 2 (иконка исчезает вразрез с затуханием).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MobileWriteScreen } from '../MobileWriteScreen';
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
    reducedMotion: false,
  }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../core/sync/useSyncStatus', () => ({ useSyncStatus: () => ({ status: 'synced', pendingCount: 0 }) }));
vi.mock('../../../../shared/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: () => ({ isVaultUnlocked: true, encryptionMode: 'none' }),
  useVaultStatus: () => ({ isVaultActive: false, isVaultUnlocked: true }),
}));

function renderScreen(overrides: Partial<ComponentProps<typeof MobileWriteScreen>> = {}) {
  return render(
    <MobileWriteScreen
      onPlay={vi.fn()}
      onStop={vi.fn()}
      status="writing"
      streakDays={0}
      sessionType="free"
      onOpenSetup={vi.fn()}
      {...overrides}
    />,
  );
}

describe('B-4: SaveStatus не теряет состояние при перемонтировании и гаснет до конца', () => {
  beforeEach(() => {
    cleanup();
    useContentStore.setState({ content: 'текст', wordCount: 1 });
    useTimerStore.setState({ status: 'writing', sessionType: 'free', wordGoal: 0, timerDuration: 0, sessionStartWords: 0, sessionStartSeconds: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('свежий монтаж в «saved» говорит про время, а не «Ещё не сохранялось»', () => {
    const tree = renderScreen({ saveStatus: 'saved' });
    const el = screen.getByTestId('save-status');
    expect(el).toHaveAttribute('aria-label', 'editor_saved_at');
    expect(el).not.toHaveAttribute('aria-label', 'editor_not_saved_yet');

    // Перемонтирование (тот же путь, что смена шапки на строку дзена): новая
    // копия обязана так же знать, что заметка сохранена.
    cleanup();
    const tree2 = renderScreen({ saveStatus: 'saved' });
    const el2 = screen.getByTestId('save-status');
    expect(el2).not.toHaveAttribute('aria-label', 'editor_not_saved_yet');
    expect(el2).toHaveAttribute('aria-label', 'editor_saved_at');
    tree.unmount();
    tree2.unmount();
  });

  it('saved→idle не снимает иконку вразрез с затуханием', () => {
    vi.useFakeTimers();
    const tree = renderScreen({ saveStatus: 'saving' });
    expect(screen.getByTestId('save-status')).toHaveAttribute('data-lit', 'true');

    tree.rerender(
      <MobileWriteScreen onPlay={vi.fn()} onStop={vi.fn()} status="writing" streakDays={0} sessionType="free" onOpenSetup={vi.fn()} saveStatus="saved" />,
    );
    // Держит свет LIT_MS после конца записи, потом начинает гаснуть.
    act(() => { vi.advanceTimersByTime(900); });
    expect(screen.getByTestId('save-status')).not.toHaveAttribute('data-lit');

    // Статус уходит в idle через секунду. Прежний условный монтаж снимал иконку
    // здесь же и обрывал 700-мс переход; теперь она досиживает затухание.
    tree.rerender(
      <MobileWriteScreen onPlay={vi.fn()} onStop={vi.fn()} status="writing" streakDays={0} sessionType="free" onOpenSetup={vi.fn()} saveStatus="idle" />,
    );
    expect(screen.getByTestId('save-status'), 'иконка снята до конца затухания').toBeInTheDocument();

    // После полного затухания на idle иконки в шапке нет.
    act(() => { vi.advanceTimersByTime(700); });
    expect(screen.queryByTestId('save-status')).toBeNull();
    tree.unmount();
  });
});
