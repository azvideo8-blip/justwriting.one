import { describe, it, expect, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { pool } from '../db';

// V-5: счётчики заметок. Тест пишет в настоящую базу и проверяет ровно то, что
// нельзя проверить моком: два параллельных писателя с одним основанием не теряют
// приращение, а устаревшая запись не откатывает current_version.
//
// Как и в deleteAccount.db.test.ts: одного DATABASE_URL мало (он бывает выставлен
// на прод через туннель), нужен явный флаг throwaway-базы.
const throwawayDb = !!process.env.DATABASE_URL && process.env.JW_THROWAWAY_DB === '1';

const docUuid = () => crypto.randomUUID();

/** RPC вызывается от имени владельца строки: auth.uid() читает request.jwt.claims. */
async function rpcAs(uid: string, pUuid: string, words: number, durationDelta: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })]);
    await client.query('select public.sync_document_stats($1, $2, $3)', [pUuid, words, durationDelta]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

async function readDoc(pUuid: string): Promise<{ current_version: number; total_words: number; total_duration: number }> {
  const res = await pool.query<{ current_version: number; total_words: number; total_duration: number }>(
    'select current_version, total_words, total_duration from public.documents where uuid = $1',
    [pUuid],
  );
  return res.rows[0]!;
}

describe.skipIf(!throwawayDb)('document counters on real Postgres (V-5)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('parallel writers on the same base do not lose an increment', async () => {
    const uid = crypto.randomUUID();
    const uuid = docUuid();
    await pool.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [uid, `v5_${uid.slice(0, 8)}@example.com`]);
    await pool.query(
      'INSERT INTO public.documents (uuid, user_id, title, current_version, total_words, total_duration) VALUES ($1, $2, $3, 1, 100, 1000)',
      [uuid, uid, 'row'],
    );

    // Два устройства прочитали одну и ту же копию и выгружают по своей сессии.
    await Promise.all([
      rpcAs(uid, uuid, 140, 300),
      rpcAs(uid, uuid, 120, 250),
    ]);

    const row = await readDoc(uuid);
    // Длительность — приращение: оба визита сложены, потеря одного из них и был баг.
    expect(row.total_duration).toBe(1550);
    // Слова — длина заметки, её клиент присылает абсолют: остаётся максимум.
    expect(row.total_words).toBe(140);

    await pool.query('delete from auth.users where id = $1', [uid]);
  });

  it('a stale smaller word count cannot shrink the counter', async () => {
    const uid = crypto.randomUUID();
    const uuid = docUuid();
    await pool.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [uid, `v5b_${uid.slice(0, 8)}@example.com`]);
    await pool.query(
      'INSERT INTO public.documents (uuid, user_id, title, current_version, total_words, total_duration) VALUES ($1, $2, $3, 4, 500, 900)',
      [uuid, uid, 'row'],
    );

    await rpcAs(uid, uuid, 12, 0);

    const row = await readDoc(uuid);
    expect(row.total_words).toBe(500);
    expect(row.total_duration).toBe(900);

    await pool.query('delete from auth.users where id = $1', [uid]);
  });

  it('current_version cannot go down: the update keeps the stored version', async () => {
    const uid = crypto.randomUUID();
    const uuid = docUuid();
    await pool.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [uid, `v5c_${uid.slice(0, 8)}@example.com`]);
    await pool.query(
      'INSERT INTO public.documents (uuid, user_id, title, current_version, total_words, total_duration) VALUES ($1, $2, $3, 7, 300, 400)',
      [uuid, uid, 'row'],
    );

    // Писатель со старой копией: отметку ниже хранящейся база не пропустит,
    // остальные поля своей правки он при этом получит (иначе это был бы отказ
    // синхронизации на экране у человека).
    const stale = await pool.query(
      'update public.documents set current_version = 3, mood = $2 where uuid = $1 returning current_version, mood',
      [uuid, 'устарело'],
    );
    expect(stale.rows[0]?.current_version).toBe(7);
    expect(stale.rows[0]?.mood).toBe('устарело');

    // Ровная и большая отметка — обычный прогресс, триггер его не трогает.
    const forward = await pool.query(
      'update public.documents set current_version = 9 where uuid = $1 returning current_version',
      [uuid],
    );
    expect(forward.rows[0]?.current_version).toBe(9);
    const equal = await pool.query(
      'update public.documents set current_version = 9 where uuid = $1 returning current_version',
      [uuid],
    );
    expect(equal.rows[0]?.current_version).toBe(9);

    await pool.query('delete from auth.users where id = $1', [uid]);
  });

  it('the rpc touches only the owner’s row', async () => {
    const owner = crypto.randomUUID();
    const stranger = crypto.randomUUID();
    const uuid = docUuid();
    await pool.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [owner, `v5o_${owner.slice(0, 8)}@example.com`]);
    await pool.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [stranger, `v5s_${stranger.slice(0, 8)}@example.com`]);
    await pool.query(
      'INSERT INTO public.documents (uuid, user_id, title, current_version, total_words, total_duration) VALUES ($1, $2, $3, 1, 100, 100)',
      [uuid, owner, 'row'],
    );

    await rpcAs(stranger, uuid, 999, 999);

    const row = await readDoc(uuid);
    expect([row.total_words, row.total_duration]).toEqual([100, 100]);

    await pool.query('delete from auth.users where id = any($1::uuid[])', [[owner, stranger]]);
  });

  // R7Q-003 (0042): probing UPDATE из отчёта Qoder — писатель со старой копией
  // одним обычным апдейтом уносил назад и sessions_count, и total_duration.
  // Триггер 0039 держал только current_version.
  it('a plain UPDATE cannot move sessions_count or total_duration backwards', async () => {
    const uid = crypto.randomUUID();
    const uuid = docUuid();
    await pool.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [uid, `r7q003_${uid.slice(0, 8)}@example.com`]);
    await pool.query(
      'INSERT INTO public.documents (uuid, user_id, title, current_version, total_words, total_duration, sessions_count) VALUES ($1, $2, $3, 5, 500, 900, 20)',
      [uuid, uid, 'row'],
    );

    const after = await pool.query(
      `update public.documents
          set current_version = 1, total_words = 1, total_duration = 1, sessions_count = 1, mood = 'из устаревшей копии'
        where uuid = $1
        returning current_version, total_words, total_duration, sessions_count, mood`,
      [uuid],
    );
    const row = after.rows[0]!;
    // Отметка версии — 0039, счётчики — 0042: устаревший писатель их не уменьшает.
    expect(row.current_version).toBe(5);
    expect(row.total_duration).toBe(900);
    expect(row.sessions_count).toBe(20);
    // Слова — единственное, что праве откатить: это длина заметки, и после
    // сокращения текста она честно становится меньше.
    expect(row.total_words).toBe(1);
    // Правку метаданных писатель при этом получает — иначе был бы красный отказ
    // синхронизации на экране у человека.
    expect(row.mood).toBe('из устаревшей копии');

    // Вперёд и ровно — обычный прогресс, триггер не трогает.
    const forward = await pool.query(
      'update public.documents set sessions_count = 21, total_duration = 950 where uuid = $1 returning sessions_count, total_duration',
      [uuid],
    );
    expect(forward.rows[0]).toMatchObject({ sessions_count: 21, total_duration: 950 });

    await pool.query('delete from auth.users where id = $1', [uid]);
  });
});
