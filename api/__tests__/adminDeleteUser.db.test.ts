import { describe, it, expect, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { pool } from '../db';
import type { postgresAiContext } from '../postgresAiContext';

// Тест пишет и удаляет строки. Одного DATABASE_URL мало: он бывает выставлен на
// прод через туннель (тоже localhost). Нужен явный флаг — его ставит только
// gates.yml на одноразовом контейнере (как в deleteAccount.db.test.ts).
const throwawayDb = !!process.env.DATABASE_URL && process.env.JW_THROWAWAY_DB === '1';

const adminCtx = (adminUid: string) => ({
  isAdmin: async (uid: string) => uid === adminUid,
} as unknown as typeof postgresAiContext);

describe.skipIf(!throwawayDb)('adminDeleteUser on real Postgres (V-3)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('removes every row of the target, nothing of the neighbour, and leaves an audit trail', async () => {
    const { adminDeleteUserLogic } = await import('../admin/admin.logic');

    const adminUid = crypto.randomUUID();
    const targetUid = crypto.randomUUID();
    const neighbourUid = crypto.randomUUID();
    for (const [uid, email] of [[adminUid, `adm_${adminUid.slice(0, 8)}@example.com`], [targetUid, `tgt_${targetUid.slice(0, 8)}@example.com`], [neighbourUid, `nei_${neighbourUid.slice(0, 8)}@example.com`]] as const) {
      await pool.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [uid, email]);
    }
    const targetDoc = crypto.randomUUID();
    const neighbourDoc = crypto.randomUUID();

    // Те же виды строк у жертвы и у соседа: удаление без where снесло бы обоих.
    for (const [uid, doc] of [[targetUid, targetDoc], [neighbourUid, neighbourDoc]] as const) {
      await pool.query('INSERT INTO public.documents (uuid, user_id, title, current_version) VALUES ($1, $2, $3, 1)', [doc, uid, 'row']);
      await pool.query('INSERT INTO public.versions (document_uuid, user_id, version, content) VALUES ($1, $2, 1, $3)', [doc, uid, 'v1']);
      await pool.query('INSERT INTO public.local_store_records (user_id, store, key, payload) VALUES ($1, $2, $3, $4)', [uid, 'aiDialogues', 'dlg-1', JSON.stringify({ updatedAt: 1 })]);
      await pool.query("INSERT INTO auth.audit_log_entries (id, payload, created_at) VALUES ($1, $2, now())", [crypto.randomUUID(), JSON.stringify({ actor_id: uid })]);
    }

    const counts = async (uid: string) => (await Promise.all([
      pool.query<{ c: number }>('select count(*)::int as c from auth.users where id = $1', [uid]),
      pool.query<{ c: number }>('select count(*)::int as c from public.users where uid = $1', [uid]),
      pool.query<{ c: number }>('select count(*)::int as c from public.documents where user_id = $1', [uid]),
      pool.query<{ c: number }>('select count(*)::int as c from public.versions where user_id = $1', [uid]),
      pool.query<{ c: number }>('select count(*)::int as c from public.local_store_records where user_id = $1', [uid]),
      pool.query<{ c: number }>("select count(*)::int as c from auth.audit_log_entries where payload->>'actor_id' = $1", [uid]),
    ])).map(r => r.rows[0]?.c ?? 0);

    expect(await counts(targetUid)).toEqual([1, 1, 1, 1, 1, 1]);

    await expect(adminDeleteUserLogic(adminCtx(adminUid), adminUid, { uid: targetUid })).resolves.toEqual({ success: true });

    // Все строки жертвы — включая каскадные (versions уходят вместе с users).
    expect(await counts(targetUid)).toEqual([0, 0, 0, 0, 0, 0]);
    // Негативный контроль: сосед цел.
    expect(await counts(neighbourUid)).toEqual([1, 1, 1, 1, 1, 1]);

    // След админского удаления живёт в базе, а не только в логе процесса.
    const trail = await pool.query<{ admin_uid: string; action: string; target_uid: string; at: string }>(
      'select admin_uid::text, action, target_uid::text, at from public.admin_actions where target_uid = $1',
      [targetUid],
    );
    expect(trail.rows.length).toBe(1);
    expect(trail.rows[0]?.admin_uid).toBe(adminUid);
    expect(trail.rows[0]?.action).toBe('delete_user');
    expect(trail.rows[0]?.target_uid).toBe(targetUid);
    expect(Number.isNaN(Date.parse(String(trail.rows[0]?.at)))).toBe(false);

    // Отказ — не строка в аудите: несуществующего пользователя сервер не удаляет.
    const ghost = crypto.randomUUID();
    await expect(adminDeleteUserLogic(adminCtx(adminUid), adminUid, { uid: ghost })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await pool.query('select 1 from public.admin_actions where target_uid = $1', [ghost])).rows).toEqual([]);

    // Удаление не убирает след: строка осталась, хотя аккаунта больше нет.
    expect(await counts(targetUid)).toEqual([0, 0, 0, 0, 0, 0]);

    // Собираем за собой, чтобы контейнер остался чистым для следующих шагов гейта.
    await pool.query('delete from public.admin_actions');
    await adminDeleteUserLogic(adminCtx(adminUid), adminUid, { uid: neighbourUid });
    const left = await pool.query<{ c: number }>('select count(*)::int as c from auth.users where id = any($1::uuid[])', [[ [adminUid, targetUid, neighbourUid] ]]);
    expect(left.rows[0]?.c).toBe(1); // админ остался — его никто не удалял
    await pool.query('delete from auth.users where id = $1', [adminUid]);
  });
});
