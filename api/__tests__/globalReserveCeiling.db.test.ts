import { describe, it, expect, afterAll } from 'vitest';
import { pool } from '../db';
import { RESERVE_GLOBAL_REQUEST_SQL } from '../postgresAiContext';

// R7Q-024(b). Проверка на живой базе: та же строка запроса, что использует
// `tryReserveGlobalRequest`. На стендовой БД (throwaway) потолок передаётся
// параметром, поэтому видно ровно то, что решит Postgres: заводится ли первая
// строка дня, если оценка входа больше денежного потолка.
const throwawayDb = !!process.env.DATABASE_URL && process.env.JW_THROWAWAY_DB === '1';
const DATE = '2099-01-01';
const CLEAN = 'delete from public.ai_global_daily where date = $1';

async function tokens(): Promise<number | null> {
  const { rows } = await pool.query('select coalesce(tokens,0) as t from public.ai_global_daily where date = $1', [DATE]);
  return rows[0] ? Number(rows[0].t) : null;
}

describe.skipIf(!throwawayDb)('R7Q-024(b): денежный потолок действует и на первом запросе дня', () => {
  afterAll(async () => {
    await pool.query(CLEAN, [DATE]);
    await pool.end();
  });

  it('оценка больше потолка — строка дня не заводится и резерв не начисляется', async () => {
    await pool.query(CLEAN, [DATE]);
    const res = await pool.query(RESERVE_GLOBAL_REQUEST_SQL, [DATE, 10_000, 5000, 1000]);

    expect(res.rowCount).toBe(0);
    expect(await tokens()).toBeNull();
  });

  it('оценка в пределах потолка — первый запрос дня проходит и резерв учитывается', async () => {
    await pool.query(CLEAN, [DATE]);
    const res = await pool.query(RESERVE_GLOBAL_REQUEST_SQL, [DATE, 10_000, 500, 1000]);

    expect(Number(res.rows[0]?.tokens_reserved)).toBe(500);
    expect(await tokens()).toBe(500);
  });

  it('второй запрос, превышающий остаток, отклоняется веткой ON CONFLICT', async () => {
    await pool.query(CLEAN, [DATE]);
    await pool.query(RESERVE_GLOBAL_REQUEST_SQL, [DATE, 10_000, 600, 1000]);
    const second = await pool.query(RESERVE_GLOBAL_REQUEST_SQL, [DATE, 10_000, 600, 1000]);

    expect(second.rowCount).toBe(0);
    expect(await tokens()).toBe(600);

    // Пока потолок не превышен — обычный прогресс проходит.
    const ok = await pool.query(RESERVE_GLOBAL_REQUEST_SQL, [DATE, 10_000, 300, 1000]);
    expect(Number(ok.rows[0]?.tokens_reserved)).toBe(900);
  });

  it('потолок по числу вызовов ($2) действует как раньше', async () => {
    await pool.query(CLEAN, [DATE]);
    await pool.query(RESERVE_GLOBAL_REQUEST_SQL, [DATE, 10_000, 10, 1_000_000]);
    const overCalls = await pool.query(RESERVE_GLOBAL_REQUEST_SQL, [DATE, 1, 10, 1_000_000]);

    expect(overCalls.rowCount).toBe(0);
    await pool.query(CLEAN, [DATE]);
  });
});
