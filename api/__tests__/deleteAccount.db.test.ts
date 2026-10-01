import { describe, it, expect, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { pool } from '../db';
import { deleteAccountLogic } from '../account';

// Тест пишет и удаляет строки. Одного DATABASE_URL мало: он бывает выставлен на
// прод через туннель (тоже localhost) для обхода базы. Нужен явный флаг — его
// ставит только gates.yml на одноразовом контейнере.
const throwawayDb = !!process.env.DATABASE_URL && process.env.JW_THROWAWAY_DB === '1';

describe.skipIf(!throwawayDb)('deleteAccount server logic on real Postgres (TB-08 Part B)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('deletes user from auth.users, public.users, and all cascading tables', async () => {
    const uid = crypto.randomUUID();
    const email = `test_del_${uid.slice(0, 8)}@example.com`;
    const docUuid = crypto.randomUUID();

    // 1. Seed user in auth.users (trigger creates public.users)
    await pool.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [uid, email]);

    // S-45 (S-10): отрицательный контроль — соседний аккаунт с теми же видами
    // строк. Удаление без where (или с чужим ключом) снесло бы и его.
    const otherUid = crypto.randomUUID();
    const otherEmail = `test_keep_${otherUid.slice(0, 8)}@example.com`;
    const otherDocUuid = crypto.randomUUID();
    await pool.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [otherUid, otherEmail]);
    await pool.query('INSERT INTO public.documents (uuid, user_id, title) VALUES ($1, $2, $3)', [otherDocUuid, otherUid, 'Keep Test Doc']);
    await pool.query('INSERT INTO public.local_store_records (user_id, store, key, payload) VALUES ($1, $2, $3, $4)', [otherUid, 'aiPortrait', 'singleton', JSON.stringify({ portrait: 'keep' })]);

    // 2. Seed rows in all user-keyed tables
    await pool.query('INSERT INTO public.documents (uuid, user_id, title) VALUES ($1, $2, $3)', [docUuid, uid, 'Delete Test Doc']);
    await pool.query('INSERT INTO public.versions (document_uuid, user_id, version, content) VALUES ($1, $2, 1, $3)', [docUuid, uid, 'Delete Test Version']);
    await pool.query('INSERT INTO public.drafts (user_id, content) VALUES ($1, $2)', [uid, 'Delete Test Draft']);
    await pool.query('INSERT INTO public.local_store_records (user_id, store, key, payload) VALUES ($1, $2, $3, $4)', [uid, 'aiPortrait', 'singleton', JSON.stringify({ portrait: 'test' })]);
    await pool.query('INSERT INTO public.ai_summaries (document_id, user_id, summary) VALUES ($1, $2, $3)', [docUuid, uid, 'Summary text']);
    await pool.query('INSERT INTO public.ai_embeddings (document_id, user_id, dim) VALUES ($1, $2, 1536)', [docUuid, uid]);
    await pool.query('INSERT INTO public.ai_usage (uid, date, data) VALUES ($1, $2, $3)', [uid, '2026-09-25', JSON.stringify({ tokens: 100 })]);
    await pool.query('INSERT INTO public.ai_usage_calls (uid, fn, tokens_in, tokens_out) VALUES ($1, $2, 50, 50)', [uid, 'chat']);
    await pool.query('INSERT INTO public.ai_daily_limit (uid, day, kind, call_count) VALUES ($1, CURRENT_DATE, $2, 1)', [uid, 'chat']);
    await pool.query('INSERT INTO public.ai_cooldown (uid, data) VALUES ($1, $2)', [uid, JSON.stringify({ cooldown: true })]);
    await pool.query('INSERT INTO public.ai_bulk_cooldown (uid, endpoint, calls) VALUES ($1, $2, 1)', [uid, 'summarize']);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.audit_log_entries (
        instance_id uuid,
        id          uuid not null primary key,
        payload     jsonb,
        created_at  timestamptz default now(),
        ip_address  varchar(64) default ''::character varying not null
      );
    `);

    const auditId1 = crypto.randomUUID();
    const auditId2 = crypto.randomUUID();
    const otherAuditId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO auth.audit_log_entries (id, payload, created_at) VALUES 
       ($1, $2, now()), 
       ($3, $4, now()),
       ($5, $6, now())`,
      [
        auditId1,
        JSON.stringify({ actor_id: uid, actor_email: email }),
        auditId2,
        JSON.stringify({ traits: { user_id: uid }, user_email: email }),
        otherAuditId,
        JSON.stringify({ actor_id: otherUid, actor_email: otherEmail }),
      ]
    );

    // Verify all seeded tables actually have rows before deletion
    const authBefore = await pool.query<{ count: number }>('SELECT count(*)::int as count FROM auth.users WHERE id = $1', [uid]);
    expect(authBefore.rows[0]?.count).toBe(1);

    const auditBefore = await pool.query<{ count: number }>(
      "SELECT count(*)::int as count FROM auth.audit_log_entries WHERE payload->>'actor_id' = $1 OR payload->'traits'->>'user_id' = $1",
      [uid]
    );
    expect(auditBefore.rows[0]?.count).toBe(2);

    // 3. Call deleteAccountLogic
    await deleteAccountLogic(null, uid);

    // 4. Verify zero rows remain across all user-keyed tables dynamically discovered
    const tablesQuery = await pool.query<{ table_schema: string; table_name: string; column_name: string }>(`
      SELECT c.table_schema, c.table_name, c.column_name 
      FROM information_schema.columns c
      JOIN information_schema.tables t ON c.table_schema = t.table_schema AND c.table_name = t.table_name
      WHERE c.table_schema IN ('public', 'auth') 
        AND t.table_type = 'BASE TABLE'
        AND (
          c.column_name IN ('user_id', 'uid')
          OR (c.table_schema = 'auth' AND c.table_name = 'users' AND c.column_name = 'id')
        )
      ORDER BY c.table_schema, c.table_name;
    `);

    const leftoverTables: string[] = [];

    for (const row of tablesQuery.rows) {
      const res = await pool.query<{ count: number }>(
        `SELECT count(*)::int as count FROM "${row.table_schema}"."${row.table_name}" WHERE "${row.column_name}"::text = $1`,
        [uid]
      );
      const count = res.rows[0]?.count ?? 0;
      if (count > 0) {
        leftoverTables.push(`${row.table_schema}.${row.table_name} (${count} rows)`);
      }
    }

    // Verify auth.audit_log_entries has 0 rows for this user
    const auditAfter = await pool.query<{ count: number }>(
      "SELECT count(*)::int as count FROM auth.audit_log_entries WHERE payload->>'actor_id' = $1 OR payload->'traits'->>'user_id' = $1",
      [uid]
    );
    const auditCount = auditAfter.rows[0]?.count ?? 0;
    if (auditCount > 0) {
      leftoverTables.push(`auth.audit_log_entries (${auditCount} rows)`);
    }

    expect(leftoverTables).toEqual([]);

    // S-45 (S-10): соседний аккаунт цел — в каждой таблице, которую трогает удаление.
    const survivors = await Promise.all([
      pool.query<{ count: number }>('SELECT count(*)::int as count FROM auth.users WHERE id = $1', [otherUid]),
      pool.query<{ count: number }>('SELECT count(*)::int as count FROM public.users WHERE uid = $1', [otherUid]),
      pool.query<{ count: number }>('SELECT count(*)::int as count FROM public.documents WHERE user_id = $1', [otherUid]),
      pool.query<{ count: number }>('SELECT count(*)::int as count FROM public.local_store_records WHERE user_id = $1', [otherUid]),
      pool.query<{ count: number }>("SELECT count(*)::int as count FROM auth.audit_log_entries WHERE payload->>'actor_id' = $1", [otherUid]),
    ]);
    expect(survivors.map(r => r.rows[0]?.count)).toEqual([1, 1, 1, 1, 1]);

    await deleteAccountLogic(null, otherUid);
  });
});
