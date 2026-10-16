import { describe, it, expect, vi, beforeEach } from 'vitest';

// R7Q-024(a): upsert окна частоты коммитился ДО проверки дневного потолка и под
// ROLLBACK не попадал. Каждый отказ `limit_exceeded` сжигал слот окна, то есть
// фоновые проходы, упёршиеся в потолок, лишались частотного бюджета целиком
// (а при 20 слотах в минуту это было видно как «фоновый ИИ встал»).
const statements: string[] = [];
let dailyCount = 1;
let windowCalls = 1;

const client = {
  query: vi.fn(async (sql: string) => {
    statements.push(String(sql).replace(/\s+/g, ' ').trim().slice(0, 60));
    if (String(sql).includes('ai_bulk_cooldown')) return { rows: [{ calls: windowCalls }], rowCount: 1 };
    if (String(sql).includes('ai_daily_limit')) return { rows: [{ call_count: dailyCount }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }),
  on: vi.fn(),
  removeListener: vi.fn(),
  release: vi.fn(),
};

vi.mock('../db', () => ({
  pool: {
    on: vi.fn(),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    connect: async () => client,
  },
}));

const { postgresAiContext } = await import('../postgresAiContext');

const idx = (needle: string) => statements.findIndex(s => s.includes(needle));

describe('R7Q-024(a): окно частоты живёт в той же транзакции, что и суточный потолок', () => {
  beforeEach(() => {
    statements.length = 0;
    client.query.mockClear();
    dailyCount = 1;
    windowCalls = 1;
  });

  it('успешный вызов: BEGIN → окно → суточный счётчик → COMMIT', async () => {
    const verdict = await postgresAiContext.checkAndIncrementBulkLimit('u_win', 'embed', 'bulk');

    expect(verdict).toEqual({ ok: true, day: expect.any(String) });
    expect(statements[0]).toBe('BEGIN');
    expect(idx('ai_bulk_cooldown')).toBeGreaterThan(idx('BEGIN'));
    expect(idx('ai_daily_limit')).toBeGreaterThan(idx('ai_bulk_cooldown'));
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('отказ по дневному потолку откатывает и окно', async () => {
    dailyCount = 100_000;   // за всяким лимитом
    const verdict = await postgresAiContext.checkAndIncrementBulkLimit('u_win2', 'embed', 'bulk');

    expect(verdict).toMatchObject({ ok: false, reason: 'limit_exceeded' });
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(idx('ai_bulk_cooldown')).toBeGreaterThan(-1);
    // Движение окна случилось внутри транзакции (после BEGIN), а не отдельным
    // запросом к пулу до неё — иначе откат его не вернул бы.
    expect(idx('ai_bulk_cooldown')).toBeGreaterThan(idx('BEGIN'));
  });

  it('перебор окна не трогает суточный счётчик', async () => {
    windowCalls = 10_000;
    await expect(postgresAiContext.checkAndIncrementBulkLimit('u_win3', 'embed', 'bulk')).resolves.toBe('RATE_LIMIT');    expect(idx('ai_daily_limit')).toBe(-1);
    expect(statements.at(-1)).toBe('ROLLBACK');
  });
});
