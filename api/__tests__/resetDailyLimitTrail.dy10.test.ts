import { describe, it, expect, vi, beforeEach } from 'vitest';

// Дейлик 30.10 Н-1 (DY10-1): админский сброс дневного лимита ИИ не писал след в
// admin_actions и не имел бюджета — тот же класс, что приглашение до DY8-3.
// Теперь: BEGIN → замок → счёт за час → DELETE → след → COMMIT; бюджет — ROLLBACK.
// Мутации: убрать insert следа → (a) красный; убрать проверку бюджета → (b) красный.
const statements: string[] = [];
let used = 0;
const client = {
  query: vi.fn(async (sql: string, _params?: unknown[]) => {
    statements.push(String(sql).replace(/\s+/g, ' ').trim().slice(0, 50));
    if (String(sql).includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: true }], rowCount: 1 };
    if (String(sql).includes('count(*)')) return { rows: [{ used }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  }),
  release: vi.fn(),
};
vi.mock('../db', () => ({ pool: { on: vi.fn(), query: vi.fn(), connect: async () => client } }));

const { postgresAiContext } = await import('../postgresAiContext');
const idx = (needle: string) => statements.findIndex(s => s.includes(needle));

describe('DY10-1: сброс лимита — след и бюджет в одной транзакции', () => {
  beforeEach(() => { statements.length = 0; used = 0; });

  it('(a) сброс пишет след reset_user_limit после DELETE и до COMMIT', async () => {
    expect(await postgresAiContext.resetDailyLimit('admin-1', 'target-1')).toBe('ok');
    expect(idx('DELETE FROM public.ai_daily_limit')).toBeGreaterThan(idx('count(*)'));
    expect(idx('insert into public.admin_actions')).toBeGreaterThan(idx('DELETE FROM public.ai_daily_limit'));
    expect(statements.at(-1)).toBe('COMMIT');
    const insert = client.query.mock.calls.find(c => String(c[0]).includes('insert into public.admin_actions'));
    expect(insert?.[1]).toEqual(['admin-1', 'reset_user_limit', 'target-1']);
  });

  it('(b) 20 сбросов за час — отказ, лимит не тронут', async () => {
    used = 20;
    expect(await postgresAiContext.resetDailyLimit('admin-1', 'target-1')).toBe('budget');
    expect(idx('DELETE FROM public.ai_daily_limit')).toBe(-1);
    expect(statements.at(-1)).toBe('ROLLBACK');
  });
});
