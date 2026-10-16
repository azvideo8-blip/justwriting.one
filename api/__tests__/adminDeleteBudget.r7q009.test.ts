import { describe, it, expect, vi, beforeEach } from 'vitest';

// R7Q-009: «Удалить» в админке — единственное целиком разрушающее действие на
// сервере, которое не платило ни за свежий ввод пароля (гейт AUD-20 стоял только
// на deleteAccount), ни за кулдаун. Украденный живовой токен одним POST'ом стирал
// весь дневник каждого не-админа: прочитать архивы он не может (ключи по
// пользователю, в базе ciphertext), а удалять — может.
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

const ADMIN = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

const ctx = {
  isAdmin: vi.fn(async (uid: string) => uid === ADMIN),
} as never;

/** Сколько удалений этого админа уже лежит в admin_actions за час. */
let deletesThisHour = 0;

describe('R7Q-009: почасовой бюджет админских удалений', () => {
  beforeEach(() => {
    deletesThisHour = 0;
    clientQuery.mockReset();
    clientQuery.mockImplementation(async (sql: string) =>
      sql.startsWith('delete from auth.users') ? { rowCount: 1, rows: [] } : { rowCount: 0, rows: [] });
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('service_accounts')) return { rowCount: 0, rows: [] };
      if (String(sql).includes('admin_actions')) return { rowCount: 1, rows: [{ used: deletesThisHour }] };
      return { rowCount: 0, rows: [] };
    });
  });

  const deleteCalls = () => clientQuery.mock.calls.filter(c => String(c[0]).startsWith('delete from'));

  it('в пределах бюджета удаляет и пишет след', async () => {
    await expect(adminDeleteUserLogic(ctx, ADMIN, { uid: TARGET })).resolves.toEqual({ success: true });
    expect(deleteCalls().length).toBeGreaterThan(0);
    const audit = clientQuery.mock.calls.find(c => String(c[0]).includes('public.admin_actions'));
    expect(audit).toBeDefined();
  });

  it('N+1-е удаление за час отказано, и ни одна строка не тронута', async () => {
    deletesThisHour = 5;   // порог
    await expect(adminDeleteUserLogic(ctx, ADMIN, { uid: TARGET })).rejects.toThrow(/час/);
    expect(deleteCalls()).toHaveLength(0);
    expect(clientQuery).not.toHaveBeenCalledWith('begin');
  });

  it('бюджет считается запросом к admin_actions, а не в памяти процесса', async () => {
    await adminDeleteUserLogic(ctx, ADMIN, { uid: TARGET });
    const budgetQuery = poolQuery.mock.calls.find(c => String(c[0]).includes('admin_actions'));
    expect(budgetQuery).toBeDefined();
    expect(String(budgetQuery?.[0])).toMatch(/at > now\(\) - interval/i);
    expect(budgetQuery?.[1]).toEqual([ADMIN]);
  });

  // Ревью 0.9.43 (TOCTOU): два параллельных запроса оба видели «4 из 5» в проверке
  // до транзакции и проходили вместе. Решает пересчёт внутри транзакции под
  // pg_advisory_xact_lock по админу. Мутация: убрать пересчёт → красный.
  it('пересчёт под блокировкой внутри транзакции: параллельный запрос уже съел бюджет — откат, ничего не удалено', async () => {
    deletesThisHour = 4;   // быстрая проверка до транзакции пропускает
    clientQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('admin_actions') && String(sql).startsWith('select count')) return { rowCount: 1, rows: [{ used: 5 }] };
      return sql.startsWith('delete from auth.users') ? { rowCount: 1, rows: [] } : { rowCount: 0, rows: [] };
    });
    await expect(adminDeleteUserLogic(ctx, ADMIN, { uid: TARGET })).rejects.toThrow(/час/);
    expect(deleteCalls()).toHaveLength(0);
    expect(clientQuery).toHaveBeenCalledWith('select pg_advisory_xact_lock(hashtext($1))', [ADMIN]);
    expect(clientQuery).toHaveBeenCalledWith('rollback');
  });
});
