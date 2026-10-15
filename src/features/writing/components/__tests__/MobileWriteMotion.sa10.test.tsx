// SA-10: движение во время набора — полоса свечения на transform, серия не с нуля,
// призрак сохранения с шрифтом редактора, шапка и строка дзена в одном слоте.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { useSaveMomentStore } from '../../store/useSaveMomentStore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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


describe('SA-10: motion while typing', () => {
  beforeEach(() => {
    cleanup();
    useContentStore.setState({ content: '', wordCount: 0 });
    useSaveMomentStore.setState({ moment: null });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('the glow bar moves with transform, not margin-left', () => {
    vi.useFakeTimers();
    useTimerStore.setState({ status: 'writing', sessionType: 'free', seconds: 1, sessionStartSeconds: 0, sessionStartWords: 0, wordGoal: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
    const { container } = renderScreen({ status: 'writing' });
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'раз' } });
    act(() => { vi.advanceTimersByTime(250); });
    const bar = container.querySelector('.blur-\\[1px\\]') as HTMLElement;
    expect(bar.style.transform).toMatch(/^translateX\(/);
    expect(bar.style.marginLeft).toBe('');
    expect(bar.className).toContain('transition-[opacity,transform]');
  });

  it('with a 3-day streak the badge shows 3 immediately, not a count from 0', () => {
    renderScreen({ status: 'idle', streakDays: 3 });
    expect(screen.getByText(/^3 home_streak_days$/)).toBeTruthy();
  });

  it('the save ghost keeps the editor font and a 16 px offset', () => {
    useContentStore.setState({ content: '', wordCount: 0 });
    act(() => { useSaveMomentStore.getState().announce({ words: 3, streakDays: null, warningText: null, text: 'Сохранённый текст' }); });
    const { container } = renderScreen({ status: 'idle' });
    const ghost = screen.getByText('Сохранённый текст') as HTMLElement;
    expect(ghost.className).toContain('top-4');
    expect(ghost.className).not.toContain('text-[18px]');
    const area = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(ghost.style.fontFamily).toBe(area.style.fontFamily);
    expect(ghost.style.fontSize).toBe(area.style.fontSize);
  });

  it('the focus screen glow is driven by a ref and transform, not React state + margin-left', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/features/writing/components/MobileFocusScreen.tsx'), 'utf8');
    expect(src).not.toMatch(/useState\(0\)/);
    expect(src).not.toMatch(/marginLeft: `/);
    expect(src).toContain('translateX(');
  });
});
