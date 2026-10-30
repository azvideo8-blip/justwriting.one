// C-6: уборка неактивированных приглашений — только старше 30 дней и только
// неподтверждённые; сбой чтения — ошибка, а не «удалено 0».
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query, deleteUser } = vi.hoisted(() => ({
  query: vi.fn(),
  deleteUser: vi.fn(async (_uid: string) => ({ error: null })),
}));

// Транзакция идёт через тот же query — порядок вызовов виден в одном списке.
vi.mock('../db', () => ({ pool: {
  query: (...a: unknown[]) => query(...a),
  connect: async () => ({ query: (...a: unknown[]) => query(...a), release: () => {} }),
} }));
vi.mock('../admin/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ auth: { admin: { deleteUser: (uid: string) => deleteUser(uid) } } }),
}));

import { listStaleInvitesLogic, deleteStaleInvitesLogic } from '../admin/admin.logic';

const ctx = { isAdmin: vi.fn(async () => true) } as never;

describe('C-6: просроченные приглашения', () => {
  beforeEach(() => { query.mockReset(); deleteUser.mockClear(); });

  it('список отдаёт только то, что вернул запрос с invited_at < now-30d', async () => {
    query.mockResolvedValueOnce({ rows: [{ uid: 'u-1', email: 'old@test', invitedAt: '2026-01-01T00:00:00Z' }] });
    const list = await listStaleInvitesLogic(ctx, 'admin', {});
    expect(list).toEqual([{ uid: 'u-1', email: 'old@test', invitedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(String(query.mock.calls[0]![0])).toContain("interval '1 day'");
    expect(query.mock.calls[0]![1]).toEqual([30]);
  });

  it('подтверждённый и свежий pending не удаляются, старый — удаляется', async () => {
    // Повторная проверка: только stale-uid проходит условие.
    query.mockImplementation(async (_sql: string, params: unknown[]) => ({
      rowCount: params?.[0] === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' ? 1 : 0,
      rows: [],
    }));

    const res = await deleteStaleInvitesLogic(ctx, 'admin', {
      uids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'],
    });

    expect(res).toEqual({ deleted: 1 });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  });

  it('сбой чтения списка — ошибка, а не пустой список', async () => {
    query.mockRejectedValueOnce(new Error('MARKER_C6_DB'));
    await expect(listStaleInvitesLogic(ctx, 'admin', {})).rejects.toMatchObject({ code: 'internal' });
  });

  // 30.10: без FK C-3 строка профиля с почтой оставалась; и след в журнале админки.
  // Мутации: убрать delete from public.users → красный; убрать insert следа → красный.
  it('удалённое приглашение: профиль удалён и след delete_stale_invite записан', async () => {
    query.mockImplementation(async () => ({ rowCount: 1, rows: [] }));
    await deleteStaleInvitesLogic(ctx, 'admin', { uids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'] });
    const sqls = query.mock.calls.map(c => String(c[0]));
    expect(sqls.some(q => q.includes('delete from public.users'))).toBe(true);
    const trail = query.mock.calls.find(c => String(c[0]).includes('insert into public.admin_actions'));
    expect(trail?.[1]).toEqual(['admin', 'delete_stale_invite', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1']);
  });

  // Ревью 0.11.2: сбой записи профиля/следа — аккаунт входа не тронут, повтор
  // его найдёт. Мутация: удалять вход до транзакции → красный.
  it('сбой записи в базу — вход не удалён, транзакция откачена', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('delete from public.users')) throw new Error('MARKER_DB_BLIP');
      return { rowCount: 1, rows: [] };
    });
    await expect(deleteStaleInvitesLogic(ctx, 'admin', { uids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'] })).rejects.toThrow();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(query.mock.calls.map(c => String(c[0]))).toContain('rollback');
  });
});

