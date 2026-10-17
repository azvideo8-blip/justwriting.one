// R7Q-014: вставку в `admin_actions` миграция 0038 обещала «читалось из админки»,
// но ни одного чтения этой таблицы в клиенте и API не было — историю удалений
// можно было увидеть только через psql. Добавляем чтение: последние строки,
// только админ, только чтение.
//
// Мутация: снять гейт `isAdmin` → красный «не-админ получил список»; вернуть
// подстановку лимита в текст запроса → красный кейс про bound-параметр.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();

vi.mock('../db', () => ({
  pool: {
    on: vi.fn(),
    query: poolQuery,
    connect: () => Promise.resolve({ query: vi.fn(), release: vi.fn(), on: vi.fn(), removeListener: vi.fn() }),
  },
}));

const { listAdminActionsLogic } = await import('../admin/admin.logic');

const ADMIN = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

function ctx(isAdmin: boolean) {
  return { isAdmin: vi.fn(async () => isAdmin) } as never;
}

beforeEach(() => {
  poolQuery.mockReset();
  poolQuery.mockResolvedValue({
    rowCount: 1,
    rows: [{ id: '7', at: new Date('2026-10-16T09:00:00Z'), admin_uid: ADMIN, action: 'delete_user', target_uid: TARGET }],
  });
});

describe('R7Q-014: чтение admin_actions', () => {
  it('не-админ получает отказ, и запрос к таблице не идёт', async () => {
    await expect(listAdminActionsLogic(ctx(false), 'someone-else', {}))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('админ получает последние строки в camelCase', async () => {
    const out = await listAdminActionsLogic(ctx(true), ADMIN, {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 7,
      action: 'delete_user',
      adminUid: ADMIN,
      targetUid: TARGET,
    });
    expect(typeof out[0]!.at).toBe('string');
  });

  it('сортировка — свежие сверху, а лимит уходит bound-параметром, не в тексте запроса', async () => {
    await listAdminActionsLogic(ctx(true), ADMIN, { limit: 25 });
    const sql = String(poolQuery.mock.calls[0]![0]);
    expect(sql.toLowerCase()).toContain('order by at desc');
    expect(sql).toContain('limit $1');
    expect(sql).not.toContain('25');
    expect(poolQuery.mock.calls[0]![1]).toEqual([25]);
  });

  it('лимит зажат: безумный запрос режется потолком, ноль и мусор — значением по умолчанию', async () => {
    await listAdminActionsLogic(ctx(true), ADMIN, { limit: 100_000 });
    expect(poolQuery.mock.calls.at(-1)![1]).toEqual([200]);

    await listAdminActionsLogic(ctx(true), ADMIN, { limit: 0 });
    expect(poolQuery.mock.calls.at(-1)![1]).toEqual([50]);

    await listAdminActionsLogic(ctx(true), ADMIN, { limit: 'двадцать' });
    expect(poolQuery.mock.calls.at(-1)![1]).toEqual([50]);

    await listAdminActionsLogic(ctx(true), ADMIN, undefined);
    expect(poolQuery.mock.calls.at(-1)![1]).toEqual([50]);
  });

  it('пустая таблица — пустой список, а не ошибка', async () => {
    poolQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    expect(await listAdminActionsLogic(ctx(true), ADMIN, {})).toEqual([]);
  });

  it('чтения не существует в диспетчере без регистрации — endpoint объявлен', async () => {
    const handlers = await import('../handlers');
    const res = await handlers.handleAiEndpoint('listAdminActions', ADMIN, {});
    expect(res.status).not.toBe(404);
  });
});
