// BR-7 (предложение ревьюера, см. tickets-2026-10-25 §BR-7; решение (а)/(б)
// ещё за владельцем): хук «В этот день» получал `enabled = returnNote === null`
// и потому не грузился ни у кого, кто писал раньше. Теперь `enabled` — то же
// условие, по которому строка рисуется: на телефоне её нет в дзене, во время
// письма и при черновике; на компьютере — то же.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MobileWriteScreen } from '../MobileWriteScreen';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';

const onThisDayArgs = vi.hoisted(() => [] as boolean[]);
const returnNote = { id: 'doc_ret', title: 'Запись трёхдневной давности', lastSessionAt: Date.now() - 3 * 86_400_000 };
const memorySession = {
  id: 's_mem', userId: 'guest_1', title: 'Год назад', content: 'Текст прошлогодней заметки.',
  createdAt: Date.now() - 365 * 86_400_000, duration: 60, wordCount: 5, charCount: 20, wpm: 5, tags: [], _isLocal: true,
};

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string, p?: Record<string, string | number>) => (p?.count !== undefined ? `${k}:${p.count}` : k), tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: false, zenModeEnabled: false, editorWidth: 'normal', zenSeenOnce: true,
    fontFamily: 'Inter', fontSize: 18, streamMode: false, toggleStreamMode: vi.fn(),
    autoHideCursor: false, aiPanelOpen: false, setAiPanelOpen: vi.fn(), lifeLogVisible: false,
    headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../../../../core/settings/SettingsContext', () => ({ useSettings: () => ({ openSettings: vi.fn() }) }));
vi.mock('../../../../features/writing/contexts/WritingSessionContext', () => ({
  useWritingSessionContext: () => ({
    flow: { setupMode: 'none', openHelp: false, setOpenHelp: vi.fn() },
    actions: {}, session: { saveStatus: 'saved', saveErrorKind: null },
    streakDays: 0, handlePlayRef: { current: null }, keystrokeTrackerRef: { current: null },
    showZen: false, reducedMotion: true,
  }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../shared/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: () => ({ isVaultUnlocked: true, encryptionMode: 'none' }),
  useVaultStatus: () => ({ isVaultActive: false, isVaultUnlocked: true }),
}));
vi.mock('../../hooks/useReturnNote', () => ({ useReturnNote: () => returnNote }));
vi.mock('../../hooks/useOnThisDayHome', () => ({
  useOnThisDayHome: (_uid: string, enabled: boolean) => {
    onThisDayArgs.push(enabled);
    return enabled ? memorySession : null;
  },
}));

function renderScreen(overrides: Partial<ComponentProps<typeof MobileWriteScreen>> = {}) {
  return render(
    <MobileWriteScreen
      onPlay={vi.fn()} onStop={vi.fn()} status="idle" streakDays={0}
      sessionType="free" onOpenSetup={vi.fn()} userId="u_br7"
      onContinueNote={vi.fn()} onOpenMemory={vi.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  cleanup();
  onThisDayArgs.length = 0;
  useContentStore.setState({ content: '', wordCount: 0 });
  useTimerStore.setState({ status: 'idle', sessionType: 'free', wordGoal: 0, timerDuration: 0, sessionStartWords: 0, sessionStartSeconds: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
});

describe('BR-7: «В этот день» живёт рядом с «Продолжить», а не вместо него', () => {
  it('есть карточка возврата — напоминание всё равно грузится и показывается', () => {
    renderScreen();
    expect(screen.getByTestId('return-to-writing')).toBeInTheDocument();
    expect(screen.getByText('Год назад')).toBeInTheDocument();
    expect(onThisDayArgs[onThisDayArgs.length - 1], 'хук выключён наличием карточки возврата').toBe(true);
  });

  it('порядок: напоминание строкой ПОД «Продолжить»', () => {
    const { container } = renderScreen();
    const ret = screen.getByTestId('return-to-writing');
    const mem = screen.getByText('Год назад').closest('div[class*="border-b"]')!;
    expect(ret.compareDocumentPosition(mem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it('идёт письмо — напоминание не грузится и не показывается', () => {
    useTimerStore.setState({ status: 'writing' } as Partial<ReturnType<typeof useTimerStore.getState>>);
    renderScreen({ status: 'writing' });
    expect(onThisDayArgs[onThisDayArgs.length - 1]).toBe(false);
    expect(screen.queryByText('Год назад')).toBeNull();
  });

  it('черновик в редакторе — напоминания нет', () => {
    renderScreen({ hasDraft: true });
    expect(onThisDayArgs[onThisDayArgs.length - 1]).toBe(false);
    expect(screen.queryByText('Год назад')).toBeNull();
  });

  it('текста заметки в напоминании нет — только название', () => {
    renderScreen();
    expect(screen.queryByText('Текст прошлогодней заметки.')).toBeNull();
  });
});
