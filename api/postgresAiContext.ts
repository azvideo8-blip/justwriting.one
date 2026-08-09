// api/postgresAiContext.ts
// Postgres-backed implementation of AiContext for the VPS service.
// Uses the tables created in supabase/migrations/0004_ai_counters.sql.

import { Pool } from 'pg';
import type { AiContext, GlobalReservation } from '../functions/src/shared/aiContext';
import { DAILY_LIMIT } from '../functions/src/shared/aiUtils';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const today = () => new Date().toISOString().slice(0, 10);

// ── Global daily cap ─────────────────────────────────────────────────────────
const GLOBAL_DAILY_LIMIT = parseInt(process.env.AI_TIER_RPD ?? '10000', 10);

async function tryReserveGlobalRequest(allowance = 8192): Promise<GlobalReservation | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const date = today();
    const res = await client.query(
      `INSERT INTO ai_global_daily (day, call_count)
       VALUES ($1, 1)
       ON CONFLICT (day) DO UPDATE SET call_count = ai_global_daily.call_count + 1
       RETURNING call_count`,
      [date],
    );
    const count = Number(res.rows[0]?.call_count ?? 1);
    if (count > GLOBAL_DAILY_LIMIT) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query('COMMIT');
    // Encode the row-key as shardId so refund can find it
    return { date, shardId: '0', allowance };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[postgresAiContext] tryReserveGlobalRequest error', e);
    return null;
  } finally {
    client.release();
  }
}

async function refundGlobalRequest(res: GlobalReservation | null | undefined): Promise<void> {
  if (!res || res.refunded) return;
  res.refunded = true;
  try {
    await pool.query(
      `UPDATE ai_global_daily SET call_count = GREATEST(0, call_count - 1) WHERE day = $1`,
      [res.date],
    );
  } catch (e) {
    console.error('[postgresAiContext] refundGlobalRequest error', e);
  }
}

// ── Per-user daily limit ─────────────────────────────────────────────────────
const PER_USER_LIMIT = parseInt(process.env.AI_DAILY_LIMIT ?? String(DAILY_LIMIT), 10);

async function checkDailyLimit(uid: string, _reasoning?: boolean): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const date = today();
    const res = await client.query(
      `INSERT INTO ai_daily_limit (uid, day, call_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (uid, day) DO UPDATE SET call_count = ai_daily_limit.call_count + 1
       RETURNING call_count`,
      [uid, date],
    );
    const count = Number(res.rows[0]?.call_count ?? 1);
    if (count > PER_USER_LIMIT) {
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
      `UPDATE ai_daily_limit SET call_count = GREATEST(0, call_count - 1) WHERE uid = $1 AND day = $2`,
      [uid, date],
    );
  } catch (e) {
    console.error('[postgresAiContext] refundDailyLimit error', e);
  }
}

async function getDailyLimitCount(uid: string): Promise<{ used: number; date: string }> {
  const date = today();
  const res = await pool.query(
    `SELECT call_count FROM ai_daily_limit WHERE uid = $1 AND day = $2`,
    [uid, date],
  );
  return { used: Number(res.rows[0]?.call_count ?? 0), date };
}

async function getUserDailyLimit(_uid: string): Promise<number> {
  return PER_USER_LIMIT;
}

async function isAdmin(_uid: string): Promise<boolean> {
  // VPS has no Firestore role store; honour JWT role from the session instead.
  // Admins are not granted elevated limits on VPS until this is wired to Supabase users table.
  return false;
}

// ── Bulk limit (reuse per-user table with a separate counter) ────────────────
const BULK_LIMIT = parseInt(process.env.AI_BULK_DAILY_LIMIT ?? '50', 10);

async function checkAndIncrementBulkLimit(uid: string): Promise<boolean> {
  // Use a separate column-level key: uid + '_bulk' + day. Quick approach: use
  // the same table with uid prefixed so we don't need a schema change.
  const bulkUid = `bulk:${uid}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const date = today();
    const res = await client.query(
      `INSERT INTO ai_daily_limit (uid, day, call_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (uid, day) DO UPDATE SET call_count = ai_daily_limit.call_count + 1
       RETURNING call_count`,
      [bulkUid, date],
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
    const bulkUid = `bulk:${uid}`;
    const date = today();
    await pool.query(
      `UPDATE ai_daily_limit SET call_count = GREATEST(0, call_count - 1) WHERE uid = $1 AND day = $2`,
      [bulkUid, date],
    );
  } catch (e) {
    console.error('[postgresAiContext] refundBulkLimit error', e);
  }
}

async function checkAndIncrementLimit(
  uid: string,
  reasoning?: boolean,
): Promise<true | 'DAILY_LIMIT' | 'RATE_LIMIT'> {
  // No cooldown tracking on VPS for now — only daily limit.
  const _ = reasoning; // unused; reasoning restriction is policy, not enforced here
  const ok = await checkDailyLimit(uid);
  return ok ? true : 'DAILY_LIMIT';
}

async function recordUsage(
  uid: string,
  _tokensIn: number,
  _tokensOut: number,
  opts?: { model?: string; fn?: string },
  _res?: GlobalReservation | null,
): Promise<void> {
  // NOT IMPLEMENTED. Token usage is not recorded anywhere, so the global token
  // cap can never fire and the admin usage table stays empty. Warn rather than
  // log, so the gap is visible in production output instead of blending into it.
  console.warn(`[postgresAiContext] recordUsage is a stub — usage NOT recorded (uid=${uid}, fn=${opts?.fn ?? 'unknown'})`);
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
