// MQ-3: баннер черновика на экране письма. Черновик уже в редакторе — строка «Черновик
// восстановлен» с одним действием «Убрать»; «Сохранить» активна и без начатой сессии.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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


describe('MQ-3: баннер черновика', () => {
  beforeEach(() => {
    cleanup();
    useContentStore.setState({ content: 'Текст черновика, уже стоящий в редакторе.', wordCount: 6 });
    useTimerStore.setState({ status: 'idle', sessionType: 'free', wordGoal: 0, timerDuration: 0, sessionStartWords: 0, sessionStartSeconds: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
  });

  it('черновик уже в редакторе: «Восстановить» нет, одно действие «Убрать»', () => {
    renderScreen({ hasDraft: true, draftInEditor: true });
    expect(screen.getByText('draft_restored')).toBeInTheDocument();
    expect(screen.queryByText('draft_restore_prompt')).toBeNull();
    expect(screen.queryByRole('button', { name: 'draft_restore' })).toBeNull();
    expect(screen.getByRole('button', { name: 'draft_remove' })).toBeInTheDocument();
  });

  it('«Убрать» спрашивает подтверждение и стирает черновик вместе с текстом', () => {
    const removeDraft = vi.fn();
    const discardDraft = vi.fn();
    renderScreen({ hasDraft: true, draftInEditor: true, removeDraft, discardDraft });
    fireEvent.click(screen.getByRole('button', { name: 'draft_remove' }));
    expect(removeDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'draft_discard' }));
    expect(removeDraft).toHaveBeenCalledTimes(1);
    expect(discardDraft).not.toHaveBeenCalled();
  });

  it('черновик не в редакторе: «Восстановить» и «Удалить», как раньше', () => {
    const restoreDraft = vi.fn();
    renderScreen({ hasDraft: true, draftInEditor: false, restoreDraft });
    expect(screen.getByText('draft_restore_prompt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'draft_restore' }));
    expect(restoreDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'draft_discard' })).toBeInTheDocument();
  });

  it('текст не обрезается, кнопки — 44 px', () => {
    renderScreen({ hasDraft: true, draftInEditor: false });
    const prompt = screen.getByText('draft_restore_prompt');
    expect(prompt.className).not.toContain('truncate');
    for (const name of ['draft_restore', 'draft_discard']) {
      expect(screen.getByRole('button', { name }).className, name).toContain('min-h-11');
    }
  });

  it('«Сохранить» активна, пока в редакторе есть текст, даже без начатой сессии', () => {
    renderScreen({ hasDraft: true, draftInEditor: true });
    expect(screen.getByRole('button', { name: 'topbar_save' })).not.toBeDisabled();
  });

  it('пустой редактор в idle: «Сохранить» по-прежнему выключена', () => {
    useContentStore.setState({ content: '', wordCount: 0 });
    renderScreen();
    expect(screen.getByRole('button', { name: 'topbar_save' })).toBeDisabled();
  });
});
