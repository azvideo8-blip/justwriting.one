// api/postgresAiContext.ts
// Postgres-backed implementation of AiContext for the VPS service.
// Uses the tables created in supabase/migrations/0004_ai_counters.sql and 0005_ai_global_daily_tokens.sql.

import { Pool } from 'pg';
import type { AiContext, GlobalReservation } from '../functions/src/shared/aiContext';
import { DAILY_LIMIT } from '../functions/src/shared/aiUtils';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const today = () => new Date().toISOString().slice(0, 10);

// ── Global daily cap ─────────────────────────────────────────────────────────
const GLOBAL_DAILY_LIMIT = parseInt(process.env.AI_TIER_RPD ?? '10000', 10);
const GLOBAL_TOKEN_LIMIT = parseInt(process.env.AI_TIER_TPD ?? '25000000', 10);

async function tryReserveGlobalRequest(allowance = 8192): Promise<GlobalReservation | null> {
  const date = today();
  try {
    const res = await pool.query(
      `INSERT INTO ai_global_daily (date, call_count)
       VALUES ($1, 1)
       ON CONFLICT (date) DO UPDATE SET call_count = ai_global_daily.call_count + 1
         WHERE ai_global_daily.call_count < $2
       RETURNING call_count, coalesce(tokens, 0) AS tokens`,
      [date, GLOBAL_DAILY_LIMIT],
    );
    if (res.rows.length === 0) {
      return null;
    }
    const tokens = Number(res.rows[0]?.tokens ?? 0);
    if (tokens + allowance > GLOBAL_TOKEN_LIMIT) {
      await pool.query(
        `UPDATE ai_global_daily SET call_count = GREATEST(0, call_count - 1) WHERE date = $1`,
        [date],
      );
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
    await pool.query(
      `UPDATE ai_global_daily SET call_count = GREATEST(0, call_count - 1) WHERE date = $1`,
      [res.date],
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

async function checkDailyLimit(uid: string, reasoning?: boolean): Promise<boolean> {
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
      return false;
    }
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[postgresAiContext] checkDailyLimit error', e);
    return false;
  } finally {
    client.release();
  }
}

async function refundDailyLimit(uid: string): Promise<void> {
  try {
    const date = today();
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

async function checkAndIncrementBulkLimit(uid: string): Promise<boolean> {
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
      return false;
    }
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[postgresAiContext] checkAndIncrementBulkLimit error', e);
    return false;
  } finally {
    client.release();
  }
}

async function refundBulkLimit(uid: string): Promise<void> {
  try {
    const date = today();
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
): Promise<true | 'DAILY_LIMIT' | 'RATE_LIMIT'> {
  const { rows } = await pool.query(
    `INSERT INTO ai_cooldown (uid, updated_at) VALUES ($1, now())
     ON CONFLICT (uid) DO UPDATE SET updated_at = now()
       WHERE ai_cooldown.updated_at < now() - ($2 || ' milliseconds')::interval
     RETURNING uid`,
    [uid, String(COOLDOWN_MS)],
  );
  if (rows.length === 0) return 'RATE_LIMIT';

  const ok = await checkDailyLimit(uid, reasoning);
  return ok ? true : 'DAILY_LIMIT';
}

async function recordUsage(
  uid: string,
  tokensIn: number,
  tokensOut: number,
  _opts?: { model?: string; fn?: string },
  _res?: GlobalReservation | null,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO ai_usage (uid, date, data)
         VALUES ($1, current_date::text,
                 jsonb_build_object('promptTokens', $2::int,
                                    'completionTokens', $3::int,
                                    'requests', 1))
       ON CONFLICT (uid, date) DO UPDATE SET data =
         jsonb_set(jsonb_set(jsonb_set(ai_usage.data,
           '{promptTokens}',     to_jsonb(coalesce((ai_usage.data->>'promptTokens')::int, 0)     + $2::int)),
           '{completionTokens}', to_jsonb(coalesce((ai_usage.data->>'completionTokens')::int, 0) + $3::int)),
           '{requests}',         to_jsonb(coalesce((ai_usage.data->>'requests')::int, 0)         + 1))`,
      [uid, tokensIn, tokensOut],
    );
    await client.query(
      `UPDATE ai_global_daily SET tokens = coalesce(tokens, 0) + $1 WHERE date = current_date::text`,
      [tokensIn + tokensOut],
    );
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
