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

    const users = await AdminUserService.getUsers(50);

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
});
