// api/postgresAiContext.ts
// Postgres-backed implementation of AiContext for the VPS service.
// Uses the tables created in supabase/migrations/0004_ai_counters.sql and 0005_ai_global_daily_tokens.sql.

import { Pool } from 'pg';
import type { AiContext, GlobalReservation, LimitVerdict } from './ai/context';
import { DAILY_LIMIT } from './ai/pure';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const today = () => new Date().toISOString().slice(0, 10);

// ── Global daily cap & Spend ceiling in Rubles ───────────────────────────────
const GLOBAL_DAILY_LIMIT = parseInt(process.env.AI_TIER_RPD ?? '10000', 10);
const GLOBAL_TOKEN_LIMIT = parseInt(process.env.AI_TIER_TPD ?? '25000000', 10);

// Hard spend ceiling in Rubles per day (e.g. AI_DAILY_SPEND_LIMIT_RUB=100)
// Defaults to unlimited/token-capped if not set.
const RUB_PER_1M_TOKENS = parseFloat(process.env.AI_RUB_PER_1M_TOKENS ?? '30');
const DAILY_SPEND_LIMIT_RUB = process.env.AI_DAILY_SPEND_LIMIT_RUB ? parseFloat(process.env.AI_DAILY_SPEND_LIMIT_RUB) : null;
const EFFECTIVE_TOKEN_LIMIT = DAILY_SPEND_LIMIT_RUB != null && DAILY_SPEND_LIMIT_RUB > 0
  ? Math.min(GLOBAL_TOKEN_LIMIT, Math.floor((DAILY_SPEND_LIMIT_RUB / RUB_PER_1M_TOKENS) * 1_000_000))
  : GLOBAL_TOKEN_LIMIT;

async function tryReserveGlobalRequest(allowance = 8192): Promise<GlobalReservation | null> {
  const date = today();
  try {
    // Резервация токенов атомарна вместе с вызовом: раньше tokens читались
    // после инкремента call_count, и N конкурентных запросов видели один и тот
    // же устаревший остаток — потолок был мягким под нагрузкой.
    const res = await pool.query(
      `INSERT INTO ai_global_daily (date, call_count, tokens)
       VALUES ($1, 1, $3::int)
       ON CONFLICT (date) DO UPDATE SET
         call_count = ai_global_daily.call_count + 1,
         tokens     = coalesce(ai_global_daily.tokens, 0) + $3::int
       WHERE ai_global_daily.call_count < $2::int
         AND coalesce(ai_global_daily.tokens, 0) + $3::int <= $4::bigint
       RETURNING coalesce(tokens, 0) AS tokens_reserved`,
      [date, GLOBAL_DAILY_LIMIT, allowance, EFFECTIVE_TOKEN_LIMIT],
    );
    if (res.rows.length === 0) {
      return null;
    }
    return { date, shardId: '0', allowance };
  } catch (e) {
    console.error('[postgresAiContext] tryReserveGlobalRequest error', e);
    return null;
  }
}

async function refundGlobalRequest(res: GlobalReservation | null | undefined): Promise<void> {
  if (!res || res.refunded) return;
  res.refunded = true;
  try {
    // Резерв снимается вместе с вызовом: иначе каждая неудача навсегда съедает
    // свой allowance из суточного потолка — час лежащего провайдера выбрал бы
    // потолок, не потратив ни одного токена.
    await pool.query(
      `UPDATE ai_global_daily
          SET call_count = GREATEST(0, call_count - 1),
              tokens     = GREATEST(0, coalesce(tokens, 0) - $2::int)
        WHERE date = $1`,
      [res.date, res.allowance],
    );
  } catch (e) {
    console.error('[postgresAiContext] refundGlobalRequest error', e);
  }
}

// ── Per-user daily limit ─────────────────────────────────────────────────────
const PER_USER_LIMIT = parseInt(process.env.AI_DAILY_LIMIT ?? String(DAILY_LIMIT), 10);
const ADMIN_DAILY_LIMIT = parseInt(process.env.AI_ADMIN_DAILY_LIMIT ?? '20', 10);

async function isAdmin(uid: string): Promise<boolean> {
  try {
    const { rows } = await pool.query('SELECT role FROM users WHERE uid = $1', [uid]);
    return rows[0]?.role === 'admin';
  } catch (e) {
    console.error('[postgresAiContext] isAdmin error', e);
    return false;
  }
}

async function getUserDailyLimit(uid: string): Promise<number> {
  if (await isAdmin(uid)) return ADMIN_DAILY_LIMIT;
  return PER_USER_LIMIT;
}

async function checkDailyLimit(uid: string, reasoning?: boolean): Promise<LimitVerdict> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const date = today();
    const baseLimit = await getUserDailyLimit(uid);
    const limit = reasoning ? Math.min(baseLimit, 5) : baseLimit;

    const res = await client.query(
      `INSERT INTO ai_daily_limit (uid, day, kind, call_count)
       VALUES ($1, $2, 'chat', 1)
       ON CONFLICT (uid, day, kind) DO UPDATE SET call_count = ai_daily_limit.call_count + 1
       RETURNING call_count`,
      [uid, date],
    );
    const count = Number(res.rows[0]?.call_count ?? 1);
    if (count > limit) {
      await client.query('ROLLBACK');
      return { ok: false, day: date };
    }
    await client.query('COMMIT');
    return { ok: true, day: date };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[postgresAiContext] checkDailyLimit error', e);
    return { ok: false, day: today() };
  } finally {
    client.release();
  }
}

async function refundDailyLimit(uid: string, chargedDay?: string): Promise<void> {
  try {
    // Refund целится в день СПИСАНИЯ. Раньше здесь был today() на момент
    // неудачи: запрос, списавший квоту в 23:58 и упавший после полуночи,
    // возвращал единицу в пустую строку — юзер терял её навсегда.
    const date = chargedDay ?? today();
    await pool.query(
      `UPDATE ai_daily_limit SET call_count = GREATEST(0, call_count - 1) WHERE uid = $1 AND day = $2 AND kind = 'chat'`,
      [uid, date],
    );
  } catch (e) {
    console.error('[postgresAiContext] refundDailyLimit error', e);
  }
}

async function getDailyLimitCount(uid: string): Promise<{ used: number; date: string }> {
  const date = today();
  const res = await pool.query(
    `SELECT call_count FROM ai_daily_limit WHERE uid = $1 AND day = $2 AND kind = 'chat'`,
    [uid, date],
  );
  return { used: Number(res.rows[0]?.call_count ?? 0), date };
}

// ── Bulk limit (reuse per-user table with a separate kind) ────────────────────
const BULK_LIMIT = parseInt(process.env.AI_BULK_DAILY_LIMIT ?? '50', 10);

async function checkAndIncrementBulkLimit(uid: string): Promise<LimitVerdict> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const date = today();
    const res = await client.query(
      `INSERT INTO ai_daily_limit (uid, day, kind, call_count)
       VALUES ($1, $2, 'bulk', 1)
       ON CONFLICT (uid, day, kind) DO UPDATE SET call_count = ai_daily_limit.call_count + 1
       RETURNING call_count`,
      [uid, date],
    );
    const count = Number(res.rows[0]?.call_count ?? 1);
    if (count > BULK_LIMIT) {
      await client.query('ROLLBACK');
      return { ok: false, day: date };
    }
    await client.query('COMMIT');
    return { ok: true, day: date };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[postgresAiContext] checkAndIncrementBulkLimit error', e);
    return { ok: false, day: today() };
  } finally {
    client.release();
  }
}

async function refundBulkLimit(uid: string, chargedDay?: string): Promise<void> {
  try {
    const date = chargedDay ?? today();
    await pool.query(
      `UPDATE ai_daily_limit SET call_count = GREATEST(0, call_count - 1) WHERE uid = $1 AND day = $2 AND kind = 'bulk'`,
      [uid, date],
    );
  } catch (e) {
    console.error('[postgresAiContext] refundBulkLimit error', e);
  }
}

const COOLDOWN_MS = 10000;

async function checkAndIncrementLimit(
  uid: string,
  reasoning?: boolean,
): Promise<{ ok: true; day: string } | 'DAILY_LIMIT' | 'RATE_LIMIT'> {
  const { rows } = await pool.query(
    `INSERT INTO ai_cooldown (uid, updated_at) VALUES ($1, now())
     ON CONFLICT (uid) DO UPDATE SET updated_at = now()
       WHERE ai_cooldown.updated_at < now() - ($2 || ' milliseconds')::interval
     RETURNING uid`,
    [uid, String(COOLDOWN_MS)],
  );
  if (rows.length === 0) return 'RATE_LIMIT';

  const verdict = await checkDailyLimit(uid, reasoning);
  return verdict.ok ? { ok: true, day: verdict.day } : 'DAILY_LIMIT';
}

async function recordUsage(
  uid: string,
  tokensIn: number,
  tokensOut: number,
  _opts?: { model?: string; fn?: string },
  reservation?: GlobalReservation | null,
): Promise<void> {
  // Дата берётся из того же today(), что и резервирование в
  // tryReserveGlobalRequest. Раньше здесь стоял current_date — это дата по
  // часовому поясу базы, и при поясе не-UTC расход писался в строку другого
  // дня, чем та, по которой проверяется потолок. Потолок при этом молчал.
  const date = today();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO ai_usage (uid, date, data)
         VALUES ($1, $4,
                 jsonb_build_object('promptTokens', $2::int,
                                    'completionTokens', $3::int,
                                    'requests', 1))
       ON CONFLICT (uid, date) DO UPDATE SET data =
         jsonb_set(jsonb_set(jsonb_set(ai_usage.data,
           '{promptTokens}',     to_jsonb(coalesce((ai_usage.data->>'promptTokens')::int, 0)     + $2::int)),
           '{completionTokens}', to_jsonb(coalesce((ai_usage.data->>'completionTokens')::int, 0) + $3::int)),
           '{requests}',         to_jsonb(coalesce((ai_usage.data->>'requests')::int, 0)         + 1))`,
      [uid, tokensIn, tokensOut, date],
    );
    // Сверка резерва с фактом: allowance уже лежит в tokens (зарезервирован
    // атомарно), добавляем только дельту. GREATEST защищает от гонки с refund.
    if (reservation && !reservation.refunded) {
      await client.query(
        `UPDATE ai_global_daily
            SET tokens = GREATEST(0, coalesce(tokens, 0) - $3::int + $1::int)
          WHERE date = $2::text`,
        [tokensIn + tokensOut, reservation.date, reservation.allowance],
      );
      reservation.refunded = true; // резерв погашен этим вызовом
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export const postgresAiContext: AiContext = {
  recordUsage,
  tryReserveGlobalRequest,
  refundGlobalRequest,
  checkDailyLimit,
  refundDailyLimit,
  getDailyLimitCount,
  getUserDailyLimit,
  isAdmin,
  checkAndIncrementBulkLimit,
  refundBulkLimit,
  checkAndIncrementLimit,
};
