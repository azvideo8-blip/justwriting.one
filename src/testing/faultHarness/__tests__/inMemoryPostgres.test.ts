import { describe, it, expect } from 'vitest';
import { InMemoryPostgres } from '../inMemoryPostgres';

// R4-029: уникальные кортежи enforced и на insert, и на upsert. Раньше insert
// стерёг только documents.uuid и versions, и подмена .upsert на .insert в
// провайдере local_store_records не замечалась никем.
describe('InMemoryPostgres unique tuples (R4-029)', () => {
  it('insert rejects a duplicate local_store_records row', () => {
    const pg = new InMemoryPostgres();
    const row = { user_id: 'u1', store: 'aiDialogues', key: 'k1', payload: '{}' };
    expect(pg.executeInsert('local_store_records', row).error).toBeNull();
    const second = pg.executeInsert('local_store_records', { ...row, payload: '{"v":2}' });
    expect(second.error?.code).toBe('23505');
    expect(pg.getRows('local_store_records')).toHaveLength(1);
  });

  it('upsert overwrites by the same tuple instead of duplicating', () => {
    const pg = new InMemoryPostgres();
    const row = { user_id: 'u1', store: 'aiDialogues', key: 'k1', payload: '{}' };
    expect(pg.executeUpsert('local_store_records', row).error).toBeNull();
    expect(pg.executeUpsert('local_store_records', { ...row, payload: '{"v":2}' }).error).toBeNull();
    const rows = pg.getRows('local_store_records');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toBe('{"v":2}');
  });

  it('documents and drafts keep their schema uniques on insert', () => {
    const pg = new InMemoryPostgres();
    expect(pg.executeInsert('documents', { uuid: 'doc-1', user_id: 'u1' }).error).toBeNull();
    expect(pg.executeInsert('documents', { uuid: 'doc-1', user_id: 'u1' }).error?.code).toBe('23505');
    expect(pg.executeInsert('drafts', { user_id: 'u1', content: 'x' }).error).toBeNull();
    expect(pg.executeInsert('drafts', { user_id: 'u1', content: 'y' }).error?.code).toBe('23505');
  });
});

// S1-3: серверный `rev`, база без 0045, потолок строк и счётчик запросов —
// общая основа для забора «всё после номера N».
describe('InMemoryPostgres rev / withRev / maxRows / request counts (S1-3)', () => {
  it('assigns rev on insert, upsert and update and ignores the client value', () => {
    const pg = new InMemoryPostgres();
    const doc = pg.executeInsert('documents', { uuid: 'd1', user_id: 'u1', rev: 999 }).data![0]!;
    const ver = pg.executeInsert('versions', { document_uuid: 'd1', user_id: 'u1', version: 1, rev: 999 }).data![0]!;
    expect(doc.rev).toBe(1);
    expect(ver.rev).toBe(2);

    const updated = pg.executeUpdate('documents', { rev: 1, title: 'x' }, [{ type: 'eq', column: 'uuid', value: 'd1' }]).data![0]!;
    expect(updated.rev).toBe(3);

    const upserted = pg.executeUpsert('versions', { document_uuid: 'd1', user_id: 'u1', version: 1, rev: 7, content: 'x' }).data![0]!;
    expect(upserted.rev).toBe(4);
    expect(pg.getRows('documents')[0]?.rev).toBe(3);
  });

  it('without 0045 any query touching rev answers 42703, and other queries still work', () => {
    const pg = new InMemoryPostgres({ withRev: false });
    const inserted = pg.executeInsert('documents', { uuid: 'd1', user_id: 'u1' }).data![0]!;
    expect('rev' in inserted).toBe(false);

    const byFilter = pg.executeSelect('documents', [{ type: 'gt', column: 'rev', value: 0 }], []);
    expect(byFilter.error).toEqual({ message: 'column documents.rev does not exist', code: '42703' });

    const byOrder = pg.executeSelect('documents', [], [{ column: 'rev', ascending: true }]);
    expect(byOrder.error?.code).toBe('42703');

    const byProjection = pg.executeSelect('documents', [], [], undefined, undefined, ['uuid', 'rev']);
    expect(byProjection.error?.code).toBe('42703');

    const plain = pg.executeSelect('documents', [{ type: 'eq', column: 'user_id', value: 'u1' }], [], undefined, undefined, ['uuid']);
    expect(plain.error).toBeNull();
    expect(plain.data).toHaveLength(1);
  });

  it('setWithRev models applying and rolling back 0045', () => {
    const pg = new InMemoryPostgres({ withRev: false });
    pg.executeInsert('documents', { uuid: 'd1', user_id: 'u1' });
    expect(pg.getRows('documents')[0]?.rev).toBeUndefined();
    pg.setWithRev(true);
    expect(pg.getRows('documents')[0]?.rev).toBe(1);
    pg.setWithRev(false);
    expect(pg.getRows('documents')[0]?.rev).toBeUndefined();
  });

  it('maxRows cuts both limit and range like PGRST_DB_MAX_ROWS', () => {
    const pg = new InMemoryPostgres({ maxRows: 3 });
    for (let i = 0; i < 5; i++) pg.executeInsert('documents', { uuid: `d${i}`, user_id: 'u1' });
    const byLimit = pg.executeSelect('documents', [], [], 10);
    expect(byLimit.data).toHaveLength(3);
    const byRange = pg.executeSelect('documents', [], [], undefined, { from: 0, to: 9 });
    expect(byRange.data).toHaveLength(3);
    const fromMiddle = pg.executeSelect('documents', [], [], undefined, { from: 2, to: 4 });
    expect(fromMiddle.data).toHaveLength(3);
  });

  it('counts requests by table and method', () => {
    const pg = new InMemoryPostgres();
    pg.resetRequestCounts();
    pg.executeSelect('documents', [], []);
    pg.executeSelect('documents', [], []);
    pg.executeInsert('documents', { uuid: 'd1', user_id: 'u1' });
    pg.executeSelect('versions', [], []);
    expect(pg.getRequestCount('documents', 'select')).toBe(2);
    expect(pg.getRequestCount('documents', 'insert')).toBe(1);
    expect(pg.getRequestCount('documents')).toBe(3);
    expect(pg.getRequestCount()).toBe(4);
  });
});
