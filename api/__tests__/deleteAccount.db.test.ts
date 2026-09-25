import { describe, it, expect, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { pool } from '../db';
import { deleteAccountLogic, telemetryRowId } from '../account';

// Тест пишет и удаляет строки. Одного DATABASE_URL мало: он бывает выставлен на
// прод через туннель (тоже localhost) для обхода базы. Нужен явный флаг — его
// ставит только gates.yml на одноразовом контейнере.
const throwawayDb = !!process.env.DATABASE_URL && process.env.JW_THROWAWAY_DB === '1';

describe.skipIf(!throwawayDb)('deleteAccount server logic on real Postgres (TB-08 Part B)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('deletes user from auth.users, public.users, anonymized_telemetry, and all cascading tables', async () => {
    process.env.TELEMETRY_ID_PEPPER = 'test-pepper-tb08';

    const uid = crypto.randomUUID();
    const email = `test_del_${uid.slice(0, 8)}@example.com`;
    const docUuid = crypto.randomUUID();
    const telId = telemetryRowId(uid);

    // 1. Seed user in auth.users (trigger creates public.users)
    await pool.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [uid, email]);

    // 2. Seed rows in all user-keyed tables
    await pool.query('INSERT INTO public.documents (uuid, user_id, title) VALUES ($1, $2, $3)', [docUuid, uid, 'Delete Test Doc']);
    await pool.query('INSERT INTO public.versions (document_uuid, user_id, version, content) VALUES ($1, $2, 1, $3)', [docUuid, uid, 'Delete Test Version']);
    await pool.query('INSERT INTO public.drafts (user_id, content) VALUES ($1, $2)', [uid, 'Delete Test Draft']);
    await pool.query('INSERT INTO public.local_store_records (user_id, store, key, payload) VALUES ($1, $2, $3, $4)', [uid, 'aiPortrait', 'singleton', JSON.stringify({ portrait: 'test' })]);
    await pool.query('INSERT INTO public.telemetry_cooldown (uid, last_sent_at) VALUES ($1, now())', [uid]);
    await pool.query('INSERT INTO public.ai_summaries (document_id, user_id, summary) VALUES ($1, $2, $3)', [docUuid, uid, 'Summary text']);
    await pool.query('INSERT INTO public.ai_embeddings (document_id, user_id, dim) VALUES ($1, $2, 1536)', [docUuid, uid]);
    await pool.query('INSERT INTO public.ai_usage (uid, date, data) VALUES ($1, $2, $3)', [uid, '2026-09-25', JSON.stringify({ tokens: 100 })]);
    await pool.query('INSERT INTO public.ai_usage_calls (uid, fn, tokens_in, tokens_out) VALUES ($1, $2, 50, 50)', [uid, 'chat']);
    await pool.query('INSERT INTO public.ai_daily_limit (uid, day, kind, call_count) VALUES ($1, CURRENT_DATE, $2, 1)', [uid, 'chat']);
    await pool.query('INSERT INTO public.ai_cooldown (uid, data) VALUES ($1, $2)', [uid, JSON.stringify({ cooldown: true })]);
    await pool.query('INSERT INTO public.ai_bulk_cooldown (uid, endpoint, calls) VALUES ($1, $2, 1)', [uid, 'summarize']);
    await pool.query('INSERT INTO public.anonymized_telemetry (id, data) VALUES ($1, $2)', [telId, JSON.stringify({ theme: 'test' })]);

    // Verify all seeded tables actually have rows before deletion
    const authBefore = await pool.query<{ count: number }>('SELECT count(*)::int as count FROM auth.users WHERE id = $1', [uid]);
    expect(authBefore.rows[0]?.count).toBe(1);

    const telBefore = await pool.query<{ count: number }>('SELECT count(*)::int as count FROM public.anonymized_telemetry WHERE id = $1', [telId]);
    expect(telBefore.rows[0]?.count).toBe(1);

    // 3. Call deleteAccountLogic
    await deleteAccountLogic(null, uid);

    // 4. Verify zero rows remain across all user-keyed tables dynamically discovered
    const tablesQuery = await pool.query<{ table_schema: string; table_name: string; column_name: string }>(`
      SELECT c.table_schema, c.table_name, c.column_name 
      FROM information_schema.columns c
      JOIN information_schema.tables t ON c.table_schema = t.table_schema AND c.table_name = t.table_name
      WHERE c.table_schema = 'public' 
        AND t.table_type = 'BASE TABLE'
        AND c.column_name IN ('user_id', 'uid')
      ORDER BY c.table_name;
    `);

    const leftoverTables: string[] = [];

    for (const row of tablesQuery.rows) {
      const res = await pool.query<{ count: number }>(
        `SELECT count(*)::int as count FROM "${row.table_schema}"."${row.table_name}" WHERE "${row.column_name}" = $1`,
        [uid]
      );
      const count = res.rows[0]?.count ?? 0;
      if (count > 0) {
        leftoverTables.push(`${row.table_schema}.${row.table_name} (${count} rows)`);
      }
    }

    // Also verify auth.users and anonymized_telemetry
    const authAfter = await pool.query<{ count: number }>('SELECT count(*)::int as count FROM auth.users WHERE id = $1', [uid]);
    const authCount = authAfter.rows[0]?.count ?? 0;
    if (authCount > 0) {
      leftoverTables.push(`auth.users (${authCount} rows)`);
    }

    const telAfter = await pool.query<{ count: number }>('SELECT count(*)::int as count FROM public.anonymized_telemetry WHERE id = $1', [telId]);
    const telCount = telAfter.rows[0]?.count ?? 0;
    if (telCount > 0) {
      leftoverTables.push(`public.anonymized_telemetry (${telCount} rows)`);
    }

    expect(leftoverTables).toEqual([]);
  });
});
