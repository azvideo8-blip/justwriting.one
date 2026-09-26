import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getStoredCursor,
  setStoredCursor,
  clearStoredCursor,
  isServerCursorAhead,
  checkAndSyncCursor,
  fetchServerCursor,
} from '../changeCursor';

const mockGetSupabase = vi.fn();
vi.mock('../../supabase/client', () => ({
  getSupabase: () => mockGetSupabase(),
}));

describe('SYNC-CURSOR-2: changeCursor', () => {
  const userId = 'user_cursor_test';
  const otherUserId = 'user_cursor_other';

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Storage & Isolation', () => {
    it('stores and retrieves cursor keyed per account', () => {
      setStoredCursor(userId, '2026-09-19T12:00:00.000Z');
      setStoredCursor(otherUserId, '2026-09-18T10:00:00.000Z');

      expect(getStoredCursor(userId)).toBe('2026-09-19T12:00:00.000Z');
      expect(getStoredCursor(otherUserId)).toBe('2026-09-18T10:00:00.000Z');

      clearStoredCursor(userId);
      expect(getStoredCursor(userId)).toBeNull();
      expect(getStoredCursor(otherUserId)).toBe('2026-09-18T10:00:00.000Z');
    });

    it('returns null for empty or non-existent cursor', () => {
      expect(getStoredCursor('non_existent')).toBeNull();
    });
  });

  describe('isServerCursorAhead', () => {
    it('returns false when serverCursor is null or undefined', () => {
      expect(isServerCursorAhead(null, '2026-09-19T12:00:00.000Z')).toBe(false);
      expect(isServerCursorAhead(undefined, '2026-09-19T12:00:00.000Z')).toBe(false);
    });

    it('returns true when storedCursor is null and serverCursor exists', () => {
      expect(isServerCursorAhead('2026-09-19T12:00:00.000Z', null)).toBe(true);
      expect(isServerCursorAhead('2026-09-19T12:00:00.000Z', undefined)).toBe(true);
    });

    it('returns false when serverCursor is equal to storedCursor', () => {
      const ts = '2026-09-19T12:00:00.000Z';
      expect(isServerCursorAhead(ts, ts)).toBe(false);
    });

    it('returns false when serverCursor is older than storedCursor', () => {
      expect(isServerCursorAhead('2026-09-18T12:00:00.000Z', '2026-09-19T12:00:00.000Z')).toBe(false);
    });

    it('returns true when serverCursor is newer than storedCursor', () => {
      expect(isServerCursorAhead('2026-09-20T12:00:00.000Z', '2026-09-19T12:00:00.000Z')).toBe(true);
    });
  });

  describe('fetchServerCursor', () => {
    it('queries greatest of documents.updated_at and versions.created_at', async () => {
      const docQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { updated_at: '2026-09-19T10:00:00.000Z', user_id: userId },
          error: null,
        }),
      };

      const verQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { created_at: '2026-09-19T11:00:00.000Z', user_id: userId },
          error: null,
        }),
      };

      mockGetSupabase.mockReturnValue({
        from: (table: string) => (table === 'documents' ? docQuery : verQuery),
      });

      const cursor = await fetchServerCursor(userId);
      // versions is newer: 11:00:00 > 10:00:00
      expect(cursor).toBe('2026-09-19T11:00:00.000Z');
    });

    it('returns documents.updated_at when newer than versions.created_at', async () => {
      const docQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { updated_at: '2026-09-19T15:00:00.000Z', user_id: userId },
          error: null,
        }),
      };

      const verQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { created_at: '2026-09-19T11:00:00.000Z', user_id: userId },
          error: null,
        }),
      };

      mockGetSupabase.mockReturnValue({
        from: (table: string) => (table === 'documents' ? docQuery : verQuery),
      });

      const cursor = await fetchServerCursor(userId);
      expect(cursor).toBe('2026-09-19T15:00:00.000Z');
    });

    // N-35: чужая свежая метка (сломанный RLS, подменённый ответ) не двигает курсор.
    it('a newer timestamp from another account is a failed read, not a new cursor', async () => {
      const q = (row: Record<string, unknown>) => ({
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
      });
      const docQuery = q({ updated_at: '2030-01-01T00:00:00.000Z', user_id: 'someone-else' });
      const verQuery = q({ created_at: '2026-09-19T11:00:00.000Z', user_id: userId });
      mockGetSupabase.mockReturnValue({ from: (table: string) => (table === 'documents' ? docQuery : verQuery) });
      await expect(fetchServerCursor(userId)).rejects.toThrow(/FOREIGN_ROW/);
    });
  });

  describe('checkAndSyncCursor', () => {
    it('Cursor check with server value equal to stored value — neither download function is called', async () => {
      const ts = '2026-09-19T12:00:00.000Z';
      setStoredCursor(userId, ts);

      const downloadAll = vi.fn().mockResolvedValue(undefined);
      const reconcileLinked = vi.fn().mockResolvedValue(undefined);
      const fetchServerCursorFn = vi.fn().mockResolvedValue(ts);

      const res = await checkAndSyncCursor(userId, {
        downloadAll,
        reconcileLinked,
        fetchServerCursorFn,
      });

      expect(res).toEqual({ checked: true, synced: false, serverCursor: ts });
      expect(downloadAll).not.toHaveBeenCalled();
      expect(reconcileLinked).not.toHaveBeenCalled();
      expect(getStoredCursor(userId)).toBe(ts);
    });

    // EA-4: проходы сообщают о сбоях значением, а не исключением.
    it.each([
      ['locked vault', { downloaded: 0, skipped: 0, failed: 0, locked: true }, { reconciled: 0, skipped: 0, failed: 0 }],
      ['a failed download', { downloaded: 3, skipped: 0, failed: 1 }, { reconciled: 0, skipped: 0, failed: 0 }],
      ['a failed reconcile', { downloaded: 0, skipped: 0, failed: 0 }, { reconciled: 0, skipped: 0, failed: 2 }],
    ])('does not advance the cursor after %s', async (_name, down, rec) => {
      const oldTs = '2026-09-19T10:00:00.000Z';
      setStoredCursor(userId, oldTs);
      await checkAndSyncCursor(userId, {
        downloadAll: vi.fn().mockResolvedValue(down),
        reconcileLinked: vi.fn().mockResolvedValue(rec),
        fetchServerCursorFn: vi.fn().mockResolvedValue('2026-09-19T14:00:00.000Z'),
      });
      expect(getStoredCursor(userId)).toBe(oldTs);
    });

    it('Server value ahead — both are called, and cursor advances only after they resolve', async () => {
      const oldTs = '2026-09-19T10:00:00.000Z';
      const newTs = '2026-09-19T14:00:00.000Z';
      setStoredCursor(userId, oldTs);

      const callOrder: string[] = [];
      const downloadAll = vi.fn(async () => {
        callOrder.push('downloadAll');
      });
      const reconcileLinked = vi.fn(async () => {
        callOrder.push('reconcileLinked');
      });
      const fetchServerCursorFn = vi.fn().mockResolvedValue(newTs);

      const res = await checkAndSyncCursor(userId, {
        downloadAll,
        reconcileLinked,
        fetchServerCursorFn,
      });

      expect(res).toEqual({ checked: true, synced: true, serverCursor: newTs });
      expect(downloadAll).toHaveBeenCalledWith(userId);
      expect(reconcileLinked).toHaveBeenCalledWith(userId);
      expect(callOrder).toContain('downloadAll');
      expect(callOrder).toContain('reconcileLinked');
      // Cursor advanced to verbatim server value
      expect(getStoredCursor(userId)).toBe(newTs);
    });

    it('Mock one to reject — assert the cursor did not move', async () => {
      const oldTs = '2026-09-19T10:00:00.000Z';
      const newTs = '2026-09-19T14:00:00.000Z';
      setStoredCursor(userId, oldTs);

      const downloadAll = vi.fn().mockResolvedValue(undefined);
      const reconcileLinked = vi.fn().mockRejectedValue(new Error('Network failure in reconcile'));
      const fetchServerCursorFn = vi.fn().mockResolvedValue(newTs);

      await expect(
        checkAndSyncCursor(userId, {
          downloadAll,
          reconcileLinked,
          fetchServerCursorFn,
        })
      ).rejects.toThrow('Network failure in reconcile');

      // Crucial requirement: failed pass must NOT advance cursor
      expect(getStoredCursor(userId)).toBe(oldTs);
    });

    it('Mock downloadAll to reject — assert the cursor did not move', async () => {
      const oldTs = '2026-09-19T10:00:00.000Z';
      const newTs = '2026-09-19T14:00:00.000Z';
      setStoredCursor(userId, oldTs);

      const downloadAll = vi.fn().mockRejectedValue(new Error('Download failed'));
      const reconcileLinked = vi.fn().mockResolvedValue(undefined);
      const fetchServerCursorFn = vi.fn().mockResolvedValue(newTs);

      await expect(
        checkAndSyncCursor(userId, {
          downloadAll,
          reconcileLinked,
          fetchServerCursorFn,
        })
      ).rejects.toThrow('Download failed');

      expect(getStoredCursor(userId)).toBe(oldTs);
    });
  });
});
