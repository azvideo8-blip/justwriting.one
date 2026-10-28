import { describe, it, expect, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../../../../testing/faultHarness/lifecycleRunner';
import { pullChangesSince, RevUnavailableError } from '../pullChanges';

/**
 * S1-4: страница забора по серверному `rev` через настоящий провайдер и
 * in-memory PostgREST стенда (RLS, потолок строк). Проверяется то, на чём
 * стоит курсор: строгий порядок, только `> since`, надгробия в выдаче и
 * `lastRev` последней строки, а не максимум таблицы.
 */
describe('pullChangesSince (S1-4)', () => {
  const runner = new LifecycleRunner();
  afterEach(() => {
    runner.interceptor.postgres.setWithRev(true);
    runner.teardown();
  });

  it('reads pages strictly after since and reports the last row of the page', async () => {
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    for (let i = 0; i < 5; i++) {
      pg.executeInsert('documents', {
        uuid: `pull-doc-${i}`, user_id: uid, title: `t${i}`,
        ...(i === 2 ? { deleted_at: '2026-01-01T00:00:00Z' } : {}),
      });
    }

    const p1 = await pullChangesSince(uid, 'documents', 0, 2);
    expect(p1.rows.map(r => r.rev)).toEqual([1, 2]);
    expect(p1.lastRev).toBe(2);

    const p2 = await pullChangesSince(uid, 'documents', p1.lastRev, 2);
    expect(p2.rows.map(r => r.rev)).toEqual([3, 4]);
    expect(p2.lastRev).toBe(4);
    // Надгробие приезжает строкой, а не отсутствием в списке.
    expect(p2.rows.find(r => r.deleted_at)).toBeTruthy();

    const p3 = await pullChangesSince(uid, 'documents', p2.lastRev, 2);
    expect(p3.rows.map(r => r.rev)).toEqual([5]);

    const empty = await pullChangesSince(uid, 'documents', p3.lastRev, 2);
    expect(empty.rows).toEqual([]);
    expect(empty.lastRev).toBe(p3.lastRev);
  });

  it('versions page carries identity only, not the ciphertext of every version', async () => {
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    pg.executeInsert('documents', { uuid: 'pull-vdoc', user_id: uid, title: 't' });
    pg.executeInsert('versions', { document_uuid: 'pull-vdoc', user_id: uid, version: 1, content: 'x' });
    const page = await pullChangesSince(uid, 'versions', 0, 10);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.document_uuid).toBe('pull-vdoc');
    expect(page.rows[0]).not.toHaveProperty('content');
    expect(page.lastRev).toBe(page.rows[0]?.rev);
  });

  it('raises RevUnavailableError when the server has no rev column', async () => {
    await runner.setup();
    const uid = runner.userId;
    runner.interceptor.postgres.executeInsert('documents', { uuid: 'pull-doc', user_id: uid, title: 't' });
    runner.interceptor.postgres.setWithRev(false);
    await expect(pullChangesSince(uid, 'documents', 0)).rejects.toBeInstanceOf(RevUnavailableError);
  });

  it('refuses a page that is not strictly ascending instead of applying it', async () => {
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    pg.executeInsert('documents', { uuid: 'pull-a', user_id: uid, title: 'a' });
    pg.executeInsert('documents', { uuid: 'pull-b', user_id: uid, title: 'b' });
    const original = pg.executeSelect.bind(pg);
    pg.executeSelect = ((table, filters, orders, limit, range, cols) => {
      const res = original(table, filters, orders, limit, range, cols);
      return { ...res, data: [...(res.data ?? [])].reverse() };
    }) as typeof pg.executeSelect;

    await expect(pullChangesSince(uid, 'documents', 0)).rejects.toThrow(/PULL_OUT_OF_ORDER/);
  });

  it('passes any other server error through, not as "no changes"', async () => {
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    pg.executeSelect = (() => ({ data: null, error: { code: '500', message: 'boom' } })) as typeof pg.executeSelect;
    await expect(pullChangesSince(uid, 'documents', 0)).rejects.toMatchObject({ code: '500' });
  });
});
