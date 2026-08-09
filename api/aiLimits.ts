// aiLimits.ts – PostgreSQL backed rate limiting
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Reserve a global daily call. Returns true if successful, false if limit exceeded. */
export async function reserveGlobalDaily(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const today = new Date().toISOString().split('T')[0];
    const res = await client.query(
      `INSERT INTO ai_global_daily (day, call_count) VALUES ($1, 1)
       ON CONFLICT (day) DO UPDATE SET call_count = ai_global_daily.call_count + 1
       RETURNING call_count;`,
      [today]
    );
    const count = Number(res.rows[0].call_count);
    // Example global limit: 10000 calls per day
    if (count > 10000) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('reserveGlobalDaily error', e);
    return false;
  } finally {
    client.release();
  }
}

/** Reserve a per‑user daily call. Returns true if within limit, false otherwise. */
export async function reserveUserDaily(uid: string, limit = 100): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const today = new Date().toISOString().split('T')[0];
    const res = await client.query(
      `INSERT INTO ai_daily_limit (uid, day, call_count) VALUES ($1, $2, 1)
       ON CONFLICT (uid, day) DO UPDATE SET call_count = ai_daily_limit.call_count + 1
       RETURNING call_count;`,
      [uid, today]
    );
    const count = Number(res.rows[0].call_count);
    if (count > limit) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('reserveUserDaily error', e);
    return false;
  } finally {
    client.release();
  }
}
