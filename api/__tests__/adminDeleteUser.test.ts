import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { postgresAiContext } from '../postgresAiContext';

// 2026-10-05: админ удаляет чужой аккаунт теми же строками и в том же порядке,
// что и самоудаление, — и никогда себя или другого админа.
const clientQuery = vi.fn();
const release = vi.fn();

vi.mock('../db', () => ({
  pool: {
    on: vi.fn(),
    query: vi.fn(),
    connect: () => Promise.resolve({ query: clientQuery, release, on: vi.fn(), removeListener: vi.fn() }),
  },
}));

const { adminDeleteUserLogic } = await import('../admin/admin.logic');
const { deleteAccountLogic } = await import('../account');

const ADMIN = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const OTHER_ADMIN = '33333333-3333-4333-8333-333333333333';

const ctx = {
  isAdmin: vi.fn(async (uid: string) => uid === ADMIN || uid === OTHER_ADMIN),
} as unknown as typeof postgresAiContext;

const statements = () => clientQuery.mock.calls.map(c => String(c[0]));

describe('adminDeleteUserLogic', () => {
  beforeEach(() => {
    clientQuery.mockReset();
    clientQuery.mockImplementation(async (sql: string) =>
      sql.startsWith('delete from auth.users') ? { rowCount: 1, rows: [] } : { rowCount: 0, rows: [] });
    release.mockClear();
  });

  it('deletes exactly what self-deletion deletes, in one transaction', async () => {
    await expect(adminDeleteUserLogic(ctx, ADMIN, { uid: TARGET })).resolves.toEqual({ success: true });
    const adminRun = statements();
    expect(adminRun[0]).toBe('begin');
    expect(adminRun.at(-1)).toBe('commit');
    for (const call of clientQuery.mock.calls.slice(1, -1)) expect(call[1]).toEqual([TARGET]);

    clientQuery.mockClear();
    await deleteAccountLogic(null, TARGET);
    expect(adminRun).toEqual(statements());
    expect(release).toHaveBeenCalled();
  });

  it('a non-admin is refused before anything is touched', async () => {
    await expect(adminDeleteUserLogic(ctx, TARGET, { uid: '44444444-4444-4444-8444-444444444444' }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('never deletes the caller or another admin', async () => {
    await expect(adminDeleteUserLogic(ctx, ADMIN, { uid: ADMIN })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(adminDeleteUserLogic(ctx, ADMIN, { uid: OTHER_ADMIN })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('an unknown user rolls back and says so', async () => {
    clientQuery.mockImplementation(async () => ({ rowCount: 0, rows: [] }));
    await expect(adminDeleteUserLogic(ctx, ADMIN, { uid: TARGET })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(statements()).toContain('rollback');
    expect(statements()).not.toContain('commit');
  });

  it('a garbage id is rejected', async () => {
    await expect(adminDeleteUserLogic(ctx, ADMIN, { uid: "x' or 1=1 --" })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(clientQuery).not.toHaveBeenCalled();
  });
});
