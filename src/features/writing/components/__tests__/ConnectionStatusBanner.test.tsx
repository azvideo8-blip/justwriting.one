import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ConnectionStatusBanner } from '../ConnectionStatusBanner';

let mockIsOnline = false;
vi.mock('../../../../shared/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));

let mockSyncStatus = {
  status: 'pending',
  pendingCount: 2,
};
vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => mockSyncStatus,
}));

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'user_1' }, isGuest: false }),
}));

let mockServerUnreachable = false;
vi.mock('../../../auth/contexts/AuthContext', () => ({
  useAuth: () => ({ serverUnreachable: mockServerUnreachable }),
}));

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'desktop' }),
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
  }),
}));

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    motion: {
      div: ({ children, className, ...props }: any) => (
        <div className={className} {...props}>{children}</div>
      ),
    },
  };
});

describe('D-20: ConnectionStatusBanner reconnect messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOnline = false;
    mockSyncStatus = { status: 'pending', pendingCount: 2 };
  });

  it('shows "Соединение восстановлено" upon reconnect when syncStatus is not synced', () => {
    mockIsOnline = false;
    const { rerender } = render(<ConnectionStatusBanner />);

    expect(screen.getByText('offline_working_locally')).toBeInTheDocument();

    // Reconnect while still pending sync
    mockIsOnline = true;
    rerender(<ConnectionStatusBanner />);

    expect(screen.getByText('connection_restored')).toBeInTheDocument();
    expect(screen.queryByText('offline_synced')).toBeNull();
  });

  it('shows "Все данные синхронизированы" upon reconnect only when syncStatus is synced', () => {
    mockIsOnline = false;
    const { rerender } = render(<ConnectionStatusBanner />);

    expect(screen.getByText('offline_working_locally')).toBeInTheDocument();

    // Reconnect with synced status
    mockIsOnline = true;
    mockSyncStatus = { status: 'synced', pendingCount: 0 };
    rerender(<ConnectionStatusBanner />);

    expect(screen.getByText('offline_synced')).toBeInTheDocument();
    expect(screen.queryByText('connection_restored')).toBeNull();
  });

  // Браузер «в сети», а сервер молчит (VPN не пропускает до него): приложение
  // тихо становилось гостевым, и человек думал, что заметки пропали.
  it('says the server is unreachable and suggests trying without a VPN', () => {
    mockIsOnline = true;
    mockServerUnreachable = true;
    render(<ConnectionStatusBanner showZen />);
    expect(screen.getByText('server_unreachable_vpn')).toBeInTheDocument();
    mockServerUnreachable = false;
  });
});
