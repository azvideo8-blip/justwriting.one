// D-10: удаление хвоста страниц записи шло одним select без pageAll — при
// числе страниц больше PAGE_SIZE PostgREST молча отдавал первую тысячу, и
// остальные оставались в облаке навсегда.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  deleted: [] as string[],
  ranges: [] as string[],
}));

const ROWS = Array.from({ length: 2500 }, (_, i) => ({ key: `dlg1#${i}` }));

vi.mock('../../supabase/client', () => {
  const builder: Record<string, unknown> = {
    select() { return builder; },
    eq() { return builder; },
    like() { return builder; },
    order() { return builder; },
    range(from: number, to: number) {
      state.ranges.push(`${from}:${to}`);
      return Promise.resolve({ data: ROWS.slice(from, to + 1), error: null });
    },
    delete() { return builder; },
    in(_col: string, keys: string[]) {
      state.deleted.push(...keys);
      return Promise.resolve({ error: null });
    },
  };
  return { getSupabase: () => ({ from: () => builder }) };
});
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { deleteLocalStorePagedRecords } from '../providers/localStore';

describe('D-10: хвост страниц удаляется через pageAll', () => {
  beforeEach(() => { state.deleted = []; state.ranges = []; });

  it('keepPages=500 — удаляются все 2000 хвостовых страниц, а не первая тысяча', async () => {
    await deleteLocalStorePagedRecords('u1', 'aiDialogues', 'dlg1', 500);

    expect(state.ranges).toEqual(['0:999', '1000:1999', '2000:2999']);
    expect(state.deleted).toHaveLength(2000);
    expect(state.deleted[0]).toBe('dlg1#500');
    expect(state.deleted.at(-1)).toBe('dlg1#2499');
  });
});
