// VIS (утверждено владельцем 04.11) на телефоне: эталон — десктоп, телефон
// подтягивается к нему (VIS-3). Приёмка, пункт 6: направленное тестирование
// сообщения без наведения — на телефоне наведения нет вовсе.
//
// Баннер не привязан ни к дзену, ни к idle: отказ записи случается ровно тогда,
// когда человек печатает, а строки синка и баннер облака в это время скрыты
// (`MobileWriteScreen.tsx:413`, `:423`). Строка статуса на телефоне не меняется:
// ошибка и так показывается словом (`save-status-text`), а `SaveStatus` с его
// подсказкой при ошибке на телефоне не рисуется (`:333`, `:397`).
//
// Мутации: снять баннер с экрана — кейсы 1-3 красные; вернуть ему привязку к
// `!showZen`/`isIdleState` — кейсы 1 и 2 красные; начать рисовать `SaveStatus`
// при ошибке — кейс 4 красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MobileWriteScreen } from '../MobileWriteScreen';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';
import { useDraftWriteAlertStore } from '../../store/useDraftWriteAlertStore';

const state = vi.hoisted(() => ({ zen: false }));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string, p?: Record<string, string | number>) => (p?.count !== undefined ? `${k}:${p.count}` : k), tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: state.zen,
    zenModeEnabled: true,
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
    session: { saveStatus: 'error', saveErrorKind: null },
    streakDays: 0,
    handlePlayRef: { current: null },
    keystrokeTrackerRef: { current: null },
    showZen: state.zen,
    reducedMotion: true,
  }),
}));
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({ status: 'unsynced', unsyncedCount: 0, pendingCount: 0, autoSyncEnabled: true, loaded: true }),
}));
vi.mock('../../../../core/sync/useEmptyDeviceDetection', () => ({
  useEmptyDeviceDetection: () => ({ shouldPrompt: false, localCount: 0, cloudCount: 0, showCloudBanner: false, dismiss: vi.fn(), recheck: vi.fn() }),
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
      status="writing"
      streakDays={0}
      sessionType="free"
      onOpenSetup={vi.fn()}
      userId="u_vis_mobile"
      {...overrides}
    />,
  );
}

beforeEach(() => {
  cleanup();
  state.zen = false;
  useDraftWriteAlertStore.setState({ rescueNotWritten: false, localWriteStuck: false });
  useContentStore.setState({ content: 'текст который печатают', wordCount: 3 });
  useTimerStore.setState({ status: 'writing', sessionType: 'free', wordGoal: 0, timerDuration: 0, sessionStartWords: 0, sessionStartSeconds: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
});

describe('VIS: баннер отказа записи на телефоне', () => {
  it('виден во время письма, без наведения и без прозрачности', () => {
    useDraftWriteAlertStore.setState({ rescueNotWritten: true });
    renderScreen();
    const bar = screen.getByTestId('draft-alert-rescue-not-written');
    expect(bar.textContent, 'сообщение пустое').toContain('editor_alert_rescue_not_written');
    // Строкой `className` проверять нельзя: `group-hover:opacity-100` содержит
    // `opacity-100`, и спрятанное до наведения сообщение прошло бы как видимое.
    const classes = [...bar.classList];
    expect(classes.some(c => c.startsWith('opacity-0')), 'сообщение спрятано прозрачностью').toBe(false);
    expect(classes.some(c => c.includes('group-hover') || c.includes('group-focus')), 'сообщение зависит от наведения').toBe(false);
    expect(screen.getAllByTestId('draft-alert-rescue-not-written'), 'баннер задвоен').toHaveLength(1);
  });

  it('виден в дзене', () => {
    state.zen = true;
    useDraftWriteAlertStore.setState({ localWriteStuck: true });
    renderScreen();
    expect(screen.getByTestId('draft-alert-local-write-stuck').textContent).toContain('editor_alert_local_write_stuck');
  });

  it('нет состояния — нет баннера', () => {
    renderScreen();
    expect(screen.queryByTestId('draft-alert-rescue-not-written')).toBeNull();
    expect(screen.queryByTestId('draft-alert-local-write-stuck')).toBeNull();
  });

  it('строка статуса без изменений: ошибка — существующим словом, подсказки нет', () => {
    useDraftWriteAlertStore.setState({ localWriteStuck: true });
    renderScreen({ saveStatus: 'error', saveErrorKind: null });
    expect(screen.getByTestId('save-status-text')).toHaveTextContent('editor_error_save');
    // `SaveStatus` (и его подсказка по наведению) при ошибке на телефоне не рисуется.
    expect(screen.queryByTestId('save-status'), 'на телефоне появилась подсказка').toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('нехватка места: то же существующее слово', () => {
    renderScreen({ saveStatus: 'error', saveErrorKind: 'quota' });
    expect(screen.getByTestId('save-status-text')).toHaveTextContent('editor_error_quota');
  });
});
