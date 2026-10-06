import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { postgresAiContext } from '../postgresAiContext';

// 2026-10-05: админ удаляет чужой аккаунт теми же строками и в том же порядке,
// что и самоудаление, — и никогда себя или другого админа.
const clientQuery = vi.fn();
const release = vi.fn();
const poolQuery = vi.fn();

vi.mock('../db', () => ({
  pool: {
    on: vi.fn(),
    query: poolQuery,
    connect: () => Promise.resolve({ query: clientQuery, release, on: vi.fn(), removeListener: vi.fn() }),
  },
}));

const { adminDeleteUserLogic } = await import('../admin/admin.logic');
const { deleteAccountLogic } = await import('../account');

const ADMIN = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const OTHER_ADMIN = '33333333-3333-4333-8333-333333333333';
const SERVICE = '55555555-5555-4555-8555-555555555555';

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
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (_sql: string, params?: unknown[]) =>
      ({ rowCount: params?.[0] === SERVICE ? 1 : 0, rows: [] }));
  });

  it('deletes exactly what self-deletion deletes, in one transaction', async () => {
    await expect(adminDeleteUserLogic(ctx, ADMIN, { uid: TARGET })).resolves.toEqual({ success: true });
    const adminRun = statements();
    expect(adminRun[0]).toBe('begin');
    expect(adminRun.at(-1)).toBe('commit');
    const deleteCalls = clientQuery.mock.calls.filter(c => String(c[0]).startsWith('delete from'));
    expect(deleteCalls.length).toBeGreaterThan(0);
    for (const call of deleteCalls) expect(call[1]).toEqual([TARGET]);

    // V-3: в той же транзакции пишется след «кто и кого удалил» (0038).
    const audit = clientQuery.mock.calls.find(c => String(c[0]).includes('public.admin_actions'));
    expect(audit).toBeDefined();
    expect(audit?.[1]).toEqual([ADMIN, 'delete_user', TARGET]);
    expect(adminRun.indexOf('commit')).toBeGreaterThan(adminRun.indexOf(String(audit?.[0])));

    clientQuery.mockClear();
    await deleteAccountLogic(null, TARGET);
    expect(statements().filter(s => s.startsWith('delete from')))
      .toEqual(deleteCalls.map(c => String(c[0])));
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
    // След пишется только про реальное удаление: иначе в audit была бы
    // строка про несуществующий аккаунт.
    expect(statements().some(s => s.includes('public.admin_actions'))).toBe(false);
  });

  it('a garbage id is rejected', async () => {
    await expect(adminDeleteUserLogic(ctx, ADMIN, { uid: "x' or 1=1 --" })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('служебный аккаунт (0040) не удаляется — на нём держится проверка выкатки', async () => {
    await expect(adminDeleteUserLogic(ctx, ADMIN, { uid: SERVICE })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(String(poolQuery.mock.calls[0]?.[0])).toContain('public.service_accounts');
    expect(clientQuery).not.toHaveBeenCalled();
  });
});
