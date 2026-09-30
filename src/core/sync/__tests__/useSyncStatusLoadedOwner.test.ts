import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';

const USER = 'user_m13_a';
const OTHER = 'user_m13_b';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));

const { useSyncStatus } = await import('../useSyncStatus');

// M-13: флаг «замер есть» общий на модуль. Первый рендер другой учётки брал его
// как есть и выдавал чужой замер за свой — «synced» на нулях.
describe('M-13: the loaded flag is not inherited from another account', () => {
  it('first render of another account is not loaded', async () => {
    localStorage.clear();
    const first = renderHook(() => useSyncStatus(USER));
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();

    const seenOther: boolean[] = [];
    const other = renderHook(() => {
      const s = useSyncStatus(OTHER);
      seenOther.push(s.loaded);
      return s;
    });
    expect(seenOther[0]).toBe(false);
    other.unmount();
  });

  it('remount of the same account starts loaded from its own snapshot', async () => {
    localStorage.clear();
    const first = renderHook(() => useSyncStatus(USER));
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();

    const seen: boolean[] = [];
    const again = renderHook(() => {
      const s = useSyncStatus(USER);
      seen.push(s.loaded);
      return s;
    });
    expect(seen[0]).toBe(true);
    again.unmount();
  });
});
