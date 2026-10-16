import { describe, it, expect, vi, beforeEach } from 'vitest';

// R7Q-012: защита служебного аккаунта и последнего админа стояла только на
// админском эндпоинте. `deleteAccount` не сверял ни `service_accounts`, ни `role`,
// так что владелец служебного аккаунта мог удалить его из Настроек — и это ломает
// каждую выкатку (проверка входа не проходит), приглашения и гейт мобильного макета
// (0041 `mobile_layout_allowed()` отвечает false всем).
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

const { deleteAccountLogic } = await import('../account');

const SERVICE_UID = '55555555-5555-4555-8555-555555555555';
const LAST_ADMIN = '66666666-6666-4666-8666-666666666666';
const ADMIN_WITH_PEER = '77777777-7777-4777-8777-777777777777';
const ADMIN_PEER = '88888888-8888-4888-8888-888888888888';
const PLAIN_UID = '99999999-9999-4999-8999-999999999999';

const roleOf = (uid: string): string =>
  (uid === LAST_ADMIN || uid === ADMIN_WITH_PEER || uid === ADMIN_PEER) ? 'admin' : 'user';

describe('R7Q-012: deleteAccount не сносит служебный аккаунт и последнего админа', () => {
  beforeEach(() => {
    clientQuery.mockReset();
    clientQuery.mockImplementation(async (sql: string) =>
      sql.startsWith('delete from auth.users') ? { rowCount: 1, rows: [] } : { rowCount: 0, rows: [] });
    release.mockClear();
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      const uid = String(params?.[0] ?? '');
      if (String(sql).includes('service_accounts')) {
        return { rowCount: uid === SERVICE_UID ? 1 : 0, rows: [] };
      }
      if (/from public.users/i.test(sql)) {
        // «Есть ли другой админ, кроме удаляемого» — запрос с `uid <> $1`.
        if (String(sql).includes('<>')) {
          const others = uid === ADMIN_WITH_PEER ? [ADMIN_PEER] : [];
          return { rowCount: others.length, rows: others.map(() => ({ role: 'admin' })) };
        }
        return { rowCount: 1, rows: [{ role: roleOf(uid) }] };
      }
      return { rowCount: 0, rows: [] };
    });
  });

  const deletes = () => clientQuery.mock.calls.filter(c => String(c[0]).startsWith('delete from'));

  it('служебный аккаунт: отказ, ни одна строка не тронута', async () => {
    await expect(deleteAccountLogic(null, SERVICE_UID)).rejects.toThrow(/служебный/i);
    expect(deletes()).toHaveLength(0);
    expect(clientQuery).not.toHaveBeenCalledWith('begin');
  });

  it('последний админ: отказ, ни одна строка не тронута', async () => {
    await expect(deleteAccountLogic(null, LAST_ADMIN)).rejects.toThrow(/админ/i);
    expect(deletes()).toHaveLength(0);
  });

  it('обычный аккаунт удаляется как раньше (перекрёсток, что проверка не тотальная)', async () => {
    await expect(deleteAccountLogic(null, PLAIN_UID)).resolves.toEqual({ success: true });
    expect(deletes().length).toBeGreaterThan(0);
  });

  it('админ, у которого есть напарник, удаляется', async () => {
    await expect(deleteAccountLogic(null, ADMIN_WITH_PEER)).resolves.toEqual({ success: true });
    expect(deletes().length).toBeGreaterThan(0);
  });
});
