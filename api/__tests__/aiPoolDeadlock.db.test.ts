// R10-8 (N-77): 10 одновременных вызовов ИИ вешали весь пул навсегда —
// каждая транзакция держала соединение и ждала одиннадцатое. Тест на живой базе
// (одноразовый контейнер в gates.yml): больше одновременных проверок лимита,
// чем соединений в пуле, — все должны пройти, и пул после них обязан отвечать.
import { describe, it, expect, afterAll } from 'vitest';
import crypto from 'node:crypto';

import { pool, STATEMENT_TIMEOUT_MS, IDLE_IN_TRANSACTION_TIMEOUT_MS } from '../db';
import { postgresAiContext } from '../postgresAiContext';

const throwawayDb = !!process.env.DATABASE_URL && process.env.JW_THROWAWAY_DB === '1';

// Заведомо больше `max` пула (10): иначе тест не попадает в очередь за соединением.
const CONCURRENCY = 16;
const BUDGET_MS = 2_000;

describe.skipIf(!throwawayDb)('пул не виснет под одновременными checkDailyLimit (N-77)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it(`${CONCURRENCY} одновременных проверок лимита проходят за ≤${BUDGET_MS} мс, пул остаётся живым`, async () => {
    // uid ссылается на public.users (23503 иначе) — строки заводятся через
    // триггер регистрации, как в deleteAccount.db.test.ts.
    const uids = Array.from({ length: CONCURRENCY }, () => crypto.randomUUID());
    for (const uid of uids) {
      await pool.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [uid, `n77_${uid.slice(0, 8)}@example.com`]);
    }

    const started = Date.now();
    const verdicts = await Promise.all(uids.map((uid) => postgresAiContext.checkDailyLimit(uid)));
    const elapsed = Date.now() - started;

    try {
      // 'unavailable' здесь — не «базы нет», а ожидание свободного соединения.
      expect(verdicts.map((v) => v.reason).filter(Boolean)).toEqual([]);
      expect(elapsed).toBeLessThan(BUDGET_MS);

      // Весь пул был бы занят навсегда — этот запрос не ответил бы никогда.
      const pingStarted = Date.now();
      const ping = await pool.query('select 1 as ok');
      expect(Number(ping.rows[0]?.ok)).toBe(1);
      expect(Date.now() - pingStarted).toBeLessThan(BUDGET_MS);
    } finally {
      await pool.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [uids]);
    }
  }, 20_000);

  // Держать пул «без потолка» — тот же риск: будущее зависшее соединение
  // занимает его навсегда. Проверка на живом соединении, что сессия действительно
  // получила лимиты из api/db.ts.
  it('соединение пула работает с лимитами из api/db.ts', async () => {
    // pg_settings возвращает значения в миллисекундах; `show` отдал бы «15s».
    const { rows } = await pool.query<{ name: string; setting: string }>(
      `SELECT name, setting FROM pg_settings WHERE name = ANY($1::text[])`,
      [['statement_timeout', 'idle_in_transaction_session_timeout']],
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, Number(r.setting)]));
    expect(byName.statement_timeout).toBe(STATEMENT_TIMEOUT_MS);
    expect(byName.idle_in_transaction_session_timeout).toBe(IDLE_IN_TRANSACTION_TIMEOUT_MS);
  }, 20_000);
});
