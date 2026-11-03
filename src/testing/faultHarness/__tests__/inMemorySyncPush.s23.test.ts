import { describe, it, expect } from 'vitest';
import { InMemoryPostgres, type SyncPushResult } from '../inMemoryPostgres';

// S2-3: `sync_push` стенда — те же случаи, что `supabase/tests/sync_push.test.sql`
// (номера проверок совпадают). Расхождение стенда с SQL-функцией — это стенд,
// который молчит там, где прод отказывает.
const A = 'user-a';
const B = 'user-b';

function one(pg: InMemoryPostgres, uid: string, item: Record<string, unknown>): SyncPushResult {
  const { data, error } = pg.executeSyncPush(uid, [item]);
  expect(error).toBeNull();
  return data![0]!;
}

const put = (base: number | null, v: unknown, key = 'singleton') =>
  ({ table: 'local_store_records', op: 'put', store: 'aiPortrait', key, base_rev: base, payload: { v } });

describe('стенд: sync_push (S2-3)', () => {
  it('1. put: без базы, вторая вставка — конфликт, верная/устаревшая база', () => {
    const pg = new InMemoryPostgres();
    const r1 = one(pg, A, put(null, 1));
    expect(r1.status).toBe('ok');
    const second = one(pg, A, put(null, 99));
    expect(second).toMatchObject({ status: 'conflict', row: { rev: r1.rev, payload: { v: 1 } } });
    const r2 = one(pg, A, put(r1.rev!, 2));
    expect(r2.status).toBe('ok');
    expect(r2.rev!).toBeGreaterThan(r1.rev!);
    expect(one(pg, A, put(r1.rev!, 3))).toMatchObject({ status: 'conflict', row: { rev: r2.rev, payload: { v: 2 } } });
  });

  it('2. надгробие: не видно клиенту, put поверх — конфликт, recreate по базе надгробия', () => {
    const pg = new InMemoryPostgres();
    const r1 = one(pg, A, put(null, 1));
    const del = { table: 'local_store_records', op: 'delete', store: 'aiPortrait', key: 'singleton' };
    expect(one(pg, A, { ...del, base_rev: r1.rev! - 1 }).status).toBe('conflict');
    const tomb = one(pg, A, { ...del, base_rev: r1.rev });
    expect(tomb.status).toBe('ok');
    expect(pg.executeSelect('local_store_records', [], []).data).toHaveLength(0);
    expect(one(pg, A, put(tomb.rev!, 4))).toMatchObject({ status: 'conflict', row: { deleted: true } });
    expect(one(pg, A, put(null, 4))).toMatchObject({ status: 'conflict', row: { deleted: true } });
    expect(one(pg, A, { ...del, base_rev: r1.rev }).status).toBe('ok');
    const recreate = { table: 'local_store_records', op: 'recreate', store: 'aiPortrait', key: 'singleton', payload: { v: 6 } };
    expect(one(pg, A, { ...recreate, base_rev: r1.rev }).status).toBe('conflict');
    expect(one(pg, A, { ...recreate, base_rev: tomb.rev }).status).toBe('ok');
    expect(pg.executeSelect('local_store_records', [], []).data?.[0]?.payload).toEqual({ v: 6 });
  });

  it('2j. голова диалога: ответ несёт метку сервера', () => {
    const pg = new InMemoryPostgres();
    const r = one(pg, A, { table: 'local_store_records', op: 'put', store: 'aiDialogues', key: 'd1', base_rev: null, payload: { updatedAt: 1 } });
    expect(r.status).toBe('ok');
    expect(typeof r.stamped_at).toBe('number');
  });

  it('3. старый клиент: слепой upsert поверх надгробия — отказ RLS', () => {
    const pg = new InMemoryPostgres();
    const r1 = one(pg, A, put(null, 1));
    one(pg, A, { table: 'local_store_records', op: 'delete', store: 'aiPortrait', key: 'singleton', base_rev: r1.rev });
    const res = pg.executeUpsert('local_store_records', { user_id: A, store: 'aiPortrait', key: 'singleton', payload: { v: 'old' } });
    expect(res.error?.code).toBe('42501');
    expect(pg.executeUpdate('local_store_records', { payload: { v: 'old' } }, []).data).toHaveLength(0);
  });

  it('4. прибавки: ok, повтор — duplicate, missing/gone ключ не тратят, 0042', () => {
    const pg = new InMemoryPostgres();
    pg.executeInsert('documents', { uuid: 'doc-a', user_id: A });
    pg.executeInsert('documents', { uuid: 'doc-gone', user_id: A, deleted_at: new Date().toISOString() });
    const delta = (uuid: string, op_id: string, sessions: number, duration: number, words: number) =>
      ({ table: 'documents', op: 'delta', uuid, op_id, sessions, duration, words });
    expect(one(pg, A, delta('doc-a', 'op1', 1, 60, 100)).status).toBe('ok');
    expect(one(pg, A, delta('doc-a', 'op1', 1, 60, 100)).status).toBe('duplicate');
    expect(one(pg, A, delta('doc-later', 'op2', 1, 5, 1)).status).toBe('missing');
    expect(one(pg, A, delta('doc-gone', 'op2', 1, 5, 1)).status).toBe('gone');
    expect(one(pg, A, delta('doc-a', 'op2', 2, -1000, 50)).status).toBe('ok');
    expect(pg.getRows('documents').find(d => d.uuid === 'doc-a')).toMatchObject({ sessions_count: 3, total_duration: 60, total_words: 100 });
  });

  it('5. чужие строки не трогаются; больше 100 элементов — отказ; без 0047 — PGRST202', () => {
    const pg = new InMemoryPostgres();
    const a = one(pg, A, put(null, 'a'));
    pg.executeInsert('documents', { uuid: 'doc-a', user_id: A, sessions_count: 3 });
    expect(one(pg, B, { ...put(null, 'b'), user_id: A }).status).toBe('ok');
    expect(one(pg, B, put(a.rev!, 'b2')).status).toBe('conflict');
    expect(one(pg, B, { table: 'documents', op: 'delta', uuid: 'doc-a', op_id: 'op3', sessions: 5, duration: 5, words: 5 }).status).toBe('missing');
    const rowA = pg.getRows('local_store_records').find(r => r.user_id === A);
    expect(rowA?.payload).toEqual({ v: 'a' });
    expect(pg.getRows('documents').find(d => d.uuid === 'doc-a')?.sessions_count).toBe(3);

    const many = Array.from({ length: 101 }, () => ({ table: 'documents', op: 'delta', uuid: 'x', op_id: 'y' }));
    expect(pg.executeSyncPush(B, many).error?.code).toBe('22023');
    expect(pg.executeSyncPush(null, []).error?.code).toBe('42501');
    pg.withSyncPush = false;
    expect(pg.executeSyncPush(A, []).error?.code).toBe('PGRST202');
  });

  it('ревью SYNC2: плохой элемент откатывает весь пакет, как транзакция функции', () => {
    const pg = new InMemoryPostgres();
    const { error } = pg.executeSyncPush(A, [put(null, 1), { table: 'local_store_records', op: 'put', store: '', key: '' }]);
    expect(error?.code).toBe('22023');
    expect(pg.getRows('local_store_records')).toEqual([]);
    expect(one(pg, A, put(null, 2)).status).toBe('ok');
  });
});

