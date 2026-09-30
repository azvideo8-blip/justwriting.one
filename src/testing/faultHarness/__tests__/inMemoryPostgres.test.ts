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
