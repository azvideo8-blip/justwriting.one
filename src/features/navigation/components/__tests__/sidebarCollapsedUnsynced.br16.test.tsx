import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { Sidebar } from '../Sidebar';

// BR-16 (ревью выпуска 0.10.11, было до пакета): развёрнутая полоса «Не
// синхронизировано» молчит при выключенной синхронизации (BR-2), а свёрнутая
// иконка в рейке — нет: человек, выбравший «только на устройстве», видит
// пульсацию каждый день. Тот же счётчик, то же решение — разные сигналы.

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ isGuest: false, user: { uid: 'u_br16' } }),
}));
vi.mock('../../../../app/useLoginModal', () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: false,
    zenModeEnabled: false,
    dismissRightPanel: vi.fn(),
  }),
  WritingSettingsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: (selector: (s: { entries: unknown[]; setPanelOpen: () => void }) => unknown) =>
    selector({ entries: [], setPanelOpen: vi.fn() }),
}));

let mockSyncStatus: Record<string, unknown> = {};
vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => mockSyncStatus,
}));

const status = (over: Record<string, unknown>) => ({
  status: 'synced',
  pendingCount: 0,
  unsyncedCount: 0,
  aiStorePendingCount: 0,
  aiStoreDeadCount: 0,
  autoSyncEnabled: true,
  loaded: true,
  ...over,
});

/** Пульсирующий значок синхронизации в нижнем блоке свёрнутой рейки. */
const pulse = (container: HTMLElement) => container.querySelector('.mt-auto .animate-pulse');

beforeEach(() => {
  mockSyncStatus = status({});
});

describe('BR-16: свёрнутая рейка не пульсирует «не синхронизировано» при выключенной синхронизации', () => {
  it('синхронизация выключена, есть незалитые заметки — значка нет', () => {
    mockSyncStatus = status({ status: 'unsynced', unsyncedCount: 3, autoSyncEnabled: false });
    const { container } = renderWithProviders(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar isAdmin={false} />
      </MemoryRouter>
    );
    expect(pulse(container), 'свёрнутая рейка пульсирует человеку без синхронизации').toBeNull();
  });

  it('контроль: синхронизация включена — значок на месте', () => {
    mockSyncStatus = status({ status: 'unsynced', unsyncedCount: 3, autoSyncEnabled: true });
    const { container } = renderWithProviders(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar isAdmin={false} />
      </MemoryRouter>
    );
    expect(pulse(container)).toBeTruthy();
  });

  it('контроль: другие статусы («нет сети») показываем и при выключенной синхронизации', () => {
    mockSyncStatus = status({ status: 'offline', autoSyncEnabled: false });
    const { container } = renderWithProviders(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar isAdmin={false} />
      </MemoryRouter>
    );
    expect(pulse(container)).toBeTruthy();
  });

  it('контроль: всё залито — значка нет ни при какой синхронизации', () => {
    mockSyncStatus = status({ status: 'synced', autoSyncEnabled: true });
    const on = renderWithProviders(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar isAdmin={false} />
      </MemoryRouter>
    );
    expect(pulse(on.container)).toBeNull();
    on.unmount();

    mockSyncStatus = status({ status: 'synced', autoSyncEnabled: false });
    const off = renderWithProviders(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar isAdmin={false} />
      </MemoryRouter>
    );
    expect(pulse(off.container)).toBeNull();
  });
});
