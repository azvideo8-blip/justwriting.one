import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { postgresAiContext } from '../postgresAiContext';

const poolQuery = vi.fn();
const poolOn = vi.fn();

vi.mock('../db', () => ({
  pool: {
    on: (...args: unknown[]) => poolOn(...args),
    query: (...args: unknown[]) => poolQuery(...args),
  },
}));

const mockInviteUserByEmail = vi.fn();
const mockSupabaseAdmin = {
  auth: {
    admin: {
      inviteUserByEmail: mockInviteUserByEmail,
    },
  },
};

const { setSupabaseAdminForTesting } = await import('../admin/supabaseAdmin');
const { inviteUserLogic, listUsersWithStatusLogic } = await import('../admin/admin.logic');
const { handleAiEndpoint } = await import('../handlers');

describe('Admin Invite & User Status Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSupabaseAdminForTesting(mockSupabaseAdmin as any);
  });

  const mockAdminCtx = {
    isAdmin: vi.fn().mockResolvedValue(true),
    getAiConsent: vi.fn().mockResolvedValue({ granted: false }),
  } as unknown as typeof postgresAiContext;

  const mockNonAdminCtx = {
    isAdmin: vi.fn().mockResolvedValue(false),
    getAiConsent: vi.fn().mockResolvedValue({ granted: false }),
  } as unknown as typeof postgresAiContext;

  describe('inviteUserLogic', () => {
    it('rejects non-admin with permission-denied', async () => {
      await expect(
        inviteUserLogic(mockNonAdminCtx, 'user-123', { email: 'test@example.com' }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'permission-denied',
        }),
      );
      expect(mockInviteUserByEmail).not.toHaveBeenCalled();
    });

    it('rejects invalid email address with invalid-argument', async () => {
      await expect(
        inviteUserLogic(mockAdminCtx, 'admin-123', { email: 'not-an-email' }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
        }),
      );
      expect(mockInviteUserByEmail).not.toHaveBeenCalled();
    });

    it('rejects email address longer than 254 chars with invalid-argument', async () => {
      const longEmail = `${'a'.repeat(245)}@example.com`; // 257 chars
      await expect(
        inviteUserLogic(mockAdminCtx, 'admin-123', { email: longEmail }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
        }),
      );
      expect(mockInviteUserByEmail).not.toHaveBeenCalled();
    });

    it('invites user successfully via GoTrue admin API', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });
      mockInviteUserByEmail.mockResolvedValueOnce({
        data: {
          user: {
            id: 'new-user-uid',
            email: 'newuser@example.com',
          },
        },
        error: null,
      });

      const res = await inviteUserLogic(mockAdminCtx, 'admin-123', { email: 'NewUser@Example.COM ' });

      expect(mockInviteUserByEmail).toHaveBeenCalledWith('newuser@example.com');
      expect(res).toEqual({
        user: {
          id: 'new-user-uid',
          email: 'newuser@example.com',
        },
        reinvited: false,
      });
    });

    it('returns reinvited: true when inviting existing unconfirmed user without password', async () => {
      poolQuery.mockResolvedValueOnce({
        rows: [{ hasPassword: false, invitedAt: '2026-09-20T10:00:00Z' }],
      });
      mockInviteUserByEmail.mockResolvedValueOnce({
        data: {
          user: {
            id: 'reinvited-user-uid',
            email: 'reinvited@example.com',
          },
        },
        error: null,
      });

      const res = await inviteUserLogic(mockAdminCtx, 'admin-123', { email: 'reinvited@example.com' });

      expect(mockInviteUserByEmail).toHaveBeenCalledWith('reinvited@example.com');
      expect(res).toEqual({
        user: {
          id: 'reinvited-user-uid',
          email: 'reinvited@example.com',
        },
        reinvited: true,
      });
    });

    it('propagates GoTrue error as invalid-argument', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });
      mockInviteUserByEmail.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'A user with this email address has already been registered' },
      });

      await expect(
        inviteUserLogic(mockAdminCtx, 'admin-123', { email: 'existing@example.com' }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'invalid-argument',
          message: 'A user with this email address has already been registered',
        }),
      );
    });
  });

  describe('listUsersWithStatusLogic', () => {
    it('rejects non-admin with permission-denied', async () => {
      await expect(
        listUsersWithStatusLogic(mockNonAdminCtx, 'user-123', {}),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'permission-denied',
        }),
      );
      expect(poolQuery).not.toHaveBeenCalled();
    });

    it('returns combined user statuses with note counts and pending flags', async () => {
      const dbRows = [
        {
          uid: 'u-1',
          email: 'invited@example.com',
          invitedAt: '2026-09-20T10:00:00.000Z',
          confirmedAt: null,
          hasPassword: false,
          createdAt: '2026-09-20T10:00:00.000Z',
          noteCount: 0,
        },
        {
          uid: 'u-2',
          email: 'active@example.com',
          invitedAt: '2026-09-10T10:00:00.000Z',
          confirmedAt: '2026-09-10T11:00:00.000Z',
          hasPassword: true,
          createdAt: '2026-09-10T10:00:00.000Z',
          noteCount: 15,
        },
        {
          uid: 'u-3',
          email: 'inactive-confirmed@example.com',
          invitedAt: '2026-09-15T10:00:00.000Z',
          confirmedAt: '2026-09-15T12:00:00.000Z',
          hasPassword: true,
          createdAt: '2026-09-15T10:00:00.000Z',
          noteCount: 0,
        },
        {
          uid: 'u-4',
          email: 'opened-no-password@example.com',
          invitedAt: '2026-09-16T10:00:00.000Z',
          confirmedAt: '2026-09-16T11:00:00.000Z',
          hasPassword: false,
          createdAt: '2026-09-16T10:00:00.000Z',
          noteCount: 0,
        },
      ];

      poolQuery.mockResolvedValueOnce({ rows: dbRows });

      const res = await listUsersWithStatusLogic(mockAdminCtx, 'admin-123', {});

      expect(res).toEqual([
        {
          uid: 'u-1',
          email: 'invited@example.com',
          invitedAt: '2026-09-20T10:00:00.000Z',
          confirmedAt: null,
          createdAt: '2026-09-20T10:00:00.000Z',
          noteCount: 0,
          pending: true,
        },
        {
          uid: 'u-2',
          email: 'active@example.com',
          invitedAt: '2026-09-10T10:00:00.000Z',
          confirmedAt: '2026-09-10T11:00:00.000Z',
          createdAt: '2026-09-10T10:00:00.000Z',
          noteCount: 15,
          pending: false,
        },
        {
          uid: 'u-3',
          email: 'inactive-confirmed@example.com',
          invitedAt: '2026-09-15T10:00:00.000Z',
          confirmedAt: '2026-09-15T12:00:00.000Z',
          createdAt: '2026-09-15T10:00:00.000Z',
          noteCount: 0,
          pending: false,
        },
        {
          uid: 'u-4',
          email: 'opened-no-password@example.com',
          invitedAt: '2026-09-16T10:00:00.000Z',
          confirmedAt: '2026-09-16T11:00:00.000Z',
          createdAt: '2026-09-16T10:00:00.000Z',
          noteCount: 0,
          pending: true,
        },
      ]);

      // Verify no sensitive document or portrait fields exist in returned objects
      for (const item of res) {
        expect(item).not.toHaveProperty('title');
        expect(item).not.toHaveProperty('content');
        expect(item).not.toHaveProperty('ai_portrait');
        expect(item).not.toHaveProperty('portrait');
      }
    });
  });

  describe('handleAiEndpoint routing and consent exemption', () => {
    it('allows inviteUser through dispatcher even if AI consent is not granted', async () => {
      // postgresAiContext is used directly inside handlers.ts, so we mock isAdmin
      poolQuery
        .mockResolvedValueOnce({ rows: [{ role: 'admin' }] }) // for isAdmin check
        .mockResolvedValueOnce({ rows: [] }); // for check existing user

      mockInviteUserByEmail.mockResolvedValueOnce({
        data: { user: { id: 'u-abc', email: 'test@example.com' } },
        error: null,
      });

      const res = await handleAiEndpoint('inviteUser', 'admin-uid', { email: 'test@example.com' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        result: {
          user: { id: 'u-abc', email: 'test@example.com' },
          reinvited: false,
        },
      });
    });

    it('allows listUsersWithStatus through dispatcher even if AI consent is not granted', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [{ role: 'admin' }] }) // for isAdmin check
        .mockResolvedValueOnce({ rows: [] }); // for listUsersWithStatus query

      const res = await handleAiEndpoint('listUsersWithStatus', 'admin-uid', {});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        result: [],
      });
    });
  });
});
