import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminUserService } from '../AdminUserService';
import { DataProvider } from '../../data';
import { callAi } from '../../ai/callAi';

vi.mock('../../data', () => ({
  DataProvider: {
    getUsers: vi.fn(),
  },
}));

vi.mock('../../ai/callAi', () => ({
  callAi: vi.fn(),
}));

describe('AdminUserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inviteUser calls callAi with inviteUser endpoint', async () => {
    vi.mocked(callAi).mockResolvedValueOnce({
      user: { id: 'new-uid', email: 'invited@example.com' },
    });

    const res = await AdminUserService.inviteUser('invited@example.com');
    expect(callAi).toHaveBeenCalledWith('inviteUser', { email: 'invited@example.com' });
    expect(res).toEqual({
      user: { id: 'new-uid', email: 'invited@example.com' },
    });
  });

  it('listUsersWithStatus calls callAi with listUsersWithStatus endpoint', async () => {
    const statuses = [
      {
        uid: 'uid-1',
        email: 'user1@example.com',
        invitedAt: null,
        confirmedAt: '2026-09-01T00:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
        noteCount: 5,
        pending: false,
      },
    ];
    vi.mocked(callAi).mockResolvedValueOnce(statuses);

    const res = await AdminUserService.listUsersWithStatus();
    expect(callAi).toHaveBeenCalledWith('listUsersWithStatus', {});
    expect(res).toEqual(statuses);
  });

  it('getUsers merges DataProvider profiles with listUsersWithStatus statuses and pending accounts', async () => {
    vi.mocked(DataProvider.getUsers).mockResolvedValueOnce([
      {
        id: 'u-1',
        email: 'user1@example.com',
        nickname: 'Alice',
        role: 'user',
      },
      {
        id: 'u-2',
        email: 'user2@example.com',
        nickname: 'Bob',
        role: 'admin',
      },
    ] as any);

    vi.mocked(callAi).mockResolvedValueOnce([
      {
        uid: 'u-1',
        email: 'user1@example.com',
        invitedAt: '2026-09-01T00:00:00.000Z',
        confirmedAt: '2026-09-01T01:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
        noteCount: 8,
        pending: false,
      },
      {
        uid: 'u-2',
        email: 'user2@example.com',
        invitedAt: null,
        confirmedAt: '2026-09-02T00:00:00.000Z',
        createdAt: '2026-09-02T00:00:00.000Z',
        noteCount: 0,
        pending: false,
      },
      {
        uid: 'u-3-pending',
        email: 'pending@example.com',
        invitedAt: '2026-09-20T00:00:00.000Z',
        confirmedAt: null,
        createdAt: '2026-09-20T00:00:00.000Z',
        noteCount: 0,
        pending: true,
      },
    ]);

    const result = await AdminUserService.getUsers(50);
    const users = result.users;

    expect(result.statusesFailed).toBe(false);
    expect(users).toHaveLength(3);

    // Enriched u-1
    expect(users[0]).toMatchObject({
      uid: 'u-1',
      email: 'user1@example.com',
      nickname: 'Alice',
      noteCount: 8,
      pending: false,
    });

    // Enriched u-2
    expect(users[1]).toMatchObject({
      uid: 'u-2',
      email: 'user2@example.com',
      nickname: 'Bob',
      noteCount: 0,
      pending: false,
    });

    // Pending user without public.users row yet
    expect(users[2]).toMatchObject({
      uid: 'u-3-pending',
      email: 'pending@example.com',
      role: 'user',
      noteCount: 0,
      pending: true,
    });
  });

  it('D-11: лишняя строка от провайдера даёт truncated и ровно N пользователей', async () => {
    vi.mocked(DataProvider.getUsers).mockResolvedValueOnce(
      Array.from({ length: 51 }, (_, i) => ({ id: `u-${i}`, email: `u${i}@example.com`, role: 'user' })) as any,
    );
    vi.mocked(callAi).mockResolvedValueOnce([]);

    const result = await AdminUserService.getUsers(50);
    expect(result.truncated).toBe(true);
    expect(result.users).toHaveLength(50);
  });

  it('D-11: ровно N строк — не обрезано', async () => {
    vi.mocked(DataProvider.getUsers).mockResolvedValueOnce(
      Array.from({ length: 50 }, (_, i) => ({ id: `u-${i}`, email: `u${i}@example.com`, role: 'user' })) as any,
    );
    vi.mocked(callAi).mockResolvedValueOnce([]);

    const result = await AdminUserService.getUsers(50);
    expect(result.truncated).toBe(false);
    expect(result.users).toHaveLength(50);
  });

  it('getUsers бросает при сбое DataProvider — иначе экран рисует пустую таблицу', async () => {
    vi.mocked(DataProvider.getUsers).mockRejectedValueOnce(new Error('MARKER_A2_DB'));
    await expect(AdminUserService.getUsers(50)).rejects.toThrow('MARKER_A2_DB');
  });

  it('getUsers отдаёт флаг statusesFailed, если статусы не прочитались', async () => {
    vi.mocked(DataProvider.getUsers).mockResolvedValueOnce([
      { id: 'u-1', email: 'user1@example.com', nickname: 'Alice', role: 'user' },
    ] as any);
    vi.mocked(callAi).mockRejectedValueOnce(new Error('MARKER_A2_STATUSES'));

    const result = await AdminUserService.getUsers(50);
    expect(result.statusesFailed).toBe(true);
    expect(result.users).toHaveLength(1);
  });
});
