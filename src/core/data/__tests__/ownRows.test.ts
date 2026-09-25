import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
import { ownRows, ownRow } from '../providers/pageAll';

// TB-14: фильтр по владельцу в запросе — просьба к серверу. Ответ сверяется ещё раз.
describe('TB-14: cloud rows of another account', () => {
  it('a list keeps only the rows of this account', () => {
    const rows = [{ user_id: 'me', t: 1 }, { user_id: 'other', t: 2 }];
    expect(ownRows(rows, 'me')).toEqual([{ user_id: 'me', t: 1 }]);
  });

  it('a single foreign row is a failed read, not «no row» (which would read as deleted)', () => {
    expect(() => ownRow({ user_id: 'other' }, 'me')).toThrow(/FOREIGN_ROW/);
    expect(ownRow(null, 'me')).toBeNull();
    expect(ownRow({ uid: 'me' }, 'me', 'uid')).toEqual({ uid: 'me' });
  });
});
