import { describe, it, expect, vi, beforeEach } from 'vitest';

// S-47 survivor (S-63): все тесты уборки мокают провайдер — сам запрос
// listTombstonedDocumentUuids (фильтры user_id и deleted_at IS NOT NULL, отсев
// чужих строк) оставался без проверки.
type Row = { uuid: string; user_id: string; deleted_at: string | null };
const table: Row[] = [];
const calls: string[] = [];

vi.mock('../../supabase/client', () => ({
  getSupabase: () => ({
    from(name: string) {
      calls.push(`from:${name}`);
      const filters: Array<(r: Row) => boolean> = [];
      const q = {
        select: (cols: string) => { calls.push(`select:${cols}`); return q; },
        eq: (col: string, val: unknown) => { calls.push(`eq:${col}=${String(val)}`); filters.push(r => (r as unknown as Record<string, unknown>)[col] === val); return q; },
        in: (col: string, vals: unknown[]) => { calls.push(`in:${col}`); filters.push(r => vals.includes((r as unknown as Record<string, unknown>)[col])); return q; },
        not: (col: string, op: string, val: unknown) => {
          calls.push(`not:${col}.${op}.${String(val)}`);
          if (op === 'is' && val === null) filters.push(r => (r as unknown as Record<string, unknown>)[col] !== null);
          return q;
        },
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
          Promise.resolve({ data: table.filter(r => filters.every(f => f(r))).map(r => ({ uuid: r.uuid, user_id: r.user_id })), error: null }).then(ok, bad),
      };
      return q;
    },
  }),
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const { listTombstonedDocumentUuids } = await import('../providers/documents');

const ME = 'user-me';
const OTHER = 'user-other';
const T_MINE = 'aaaaaaaa-0000-4000-8000-000000000001';
const LIVE_MINE = 'aaaaaaaa-0000-4000-8000-000000000002';
const T_OTHER = 'aaaaaaaa-0000-4000-8000-000000000003';

describe('S-47: listTombstonedDocumentUuids query', () => {
  beforeEach(() => {
    table.length = 0;
    calls.length = 0;
    table.push(
      { uuid: T_MINE, user_id: ME, deleted_at: '2026-10-01T00:00:00Z' },
      { uuid: LIVE_MINE, user_id: ME, deleted_at: null },
      { uuid: T_OTHER, user_id: OTHER, deleted_at: '2026-10-01T00:00:00Z' },
    );
  });

  it('asks only for this user\'s tombstones among the given ids and returns only them', async () => {
    const out = await listTombstonedDocumentUuids(ME, [T_MINE, LIVE_MINE, T_OTHER]);
    expect(out).toEqual([T_MINE]);
    expect(calls).toContain(`eq:user_id=${ME}`);
    expect(calls).toContain('in:uuid');
    expect(calls).toContain('not:deleted_at.is.null');
  });

  it('a foreign row that slipped past the filter is dropped client-side', async () => {
    // Сервер «забыл» фильтр по владельцу: отдаём и чужое надгробие.
    table.find(r => r.uuid === T_OTHER)!.user_id = OTHER;
    const out = await listTombstonedDocumentUuids(ME, [T_MINE, T_OTHER]);
    expect(out).not.toContain(T_OTHER);
  });

  it('an empty id list makes no request', async () => {
    expect(await listTombstonedDocumentUuids(ME, [])).toEqual([]);
    expect(calls).toEqual([]);
  });
});
