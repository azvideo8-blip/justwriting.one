// A-2: «не прочиталось» ≠ «пусто» в админке. Путь настоящий: DataProvider/CallAi —
// край (IndexedDB и сервер), дальше реальные AdminUserService, useDiagnosticsData
// и таблицы. Проверяем то, что видит человек, а не внутренние флаги.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getUsers: vi.fn(),
  callAi: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../../../core/data', () => ({ DataProvider: { getUsers: (...a: unknown[]) => mocks.getUsers(...a) } }));
vi.mock('../../../../core/ai/callAi', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../core/ai/callAi')>();
  return { ...actual, callAi: (...a: unknown[]) => mocks.callAi(...a) };
});
vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'admin-1', email: 'admin@example.com' }),
  reauthenticate: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../auth/hooks/useAdminStatus', () => ({
  useAdminStatus: () => ({ isAdmin: true, isStaleToken: false, error: null }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { useDiagnosticsData } from '../useDiagnosticsData';
import { AdminUsersTable } from '../../../admin/components/AdminUsersTable';
import { AdminActionsTable } from '../../../admin/components/AdminActionsTable';

function Harness() {
  const data = useDiagnosticsData(null, false, 'users');
  return (
    <>
      <AdminUsersTable
        users={data.users}
        error={data.usersError}
        statusesFailed={data.usersStatusesFailed}
        onRetry={() => { void data.fetchData(); }}
      />
      <AdminActionsTable actions={data.adminActions} error={data.adminActionsError} />
    </>
  );
}

describe('A-2: админ-данные при сбоях', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callAi.mockImplementation(async (endpoint: unknown) => {
      if (endpoint === 'listUsersWithStatus') return [];
      if (endpoint === 'listAdminActions') return [];
      return {};
    });
  });
  afterEach(cleanup);

  it('сбой DataProvider.getUsers — в таблице ошибка и «Повторить», а не шапка без строк', async () => {
    mocks.getUsers.mockRejectedValue(new Error('MARKER_A2_DB'));
    render(<Harness />);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('admin_users_load_error'));
    expect(screen.getByText('retry')).toBeTruthy();
    expect(screen.queryByText('admin_users_empty')).toBeNull();
  });

  it('сбой статусов — список есть, рядом пометка', async () => {
    mocks.getUsers.mockResolvedValue([{ id: 'u-1', email: 'user1@example.com', nickname: 'Alice', role: 'user' }]);
    mocks.callAi.mockImplementation(async (endpoint: unknown) => {
      if (endpoint === 'listUsersWithStatus') throw new Error('MARKER_A2_STATUSES');
      if (endpoint === 'listAdminActions') return [];
      return {};
    });
    render(<Harness />);

    await waitFor(() => expect(screen.getByText('user1@example.com')).toBeTruthy());
    expect(screen.getByText('admin_users_statuses_failed')).toBeTruthy();
  });

  it('сбой журнала действий — «не загрузился», а не «пусто»', async () => {
    mocks.getUsers.mockResolvedValue([{ id: 'u-1', email: 'user1@example.com', nickname: 'Alice', role: 'user' }]);
    mocks.callAi.mockImplementation(async (endpoint: unknown) => {
      if (endpoint === 'listUsersWithStatus') return [];
      if (endpoint === 'listAdminActions') throw new Error('MARKER_A2_ACTIONS');
      return {};
    });
    render(<Harness />);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('admin_actions_load_error'));
    expect(screen.queryByText('admin_actions_empty')).toBeNull();
  });
});
