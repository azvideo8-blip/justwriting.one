import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatBytes,
  requestPersistentStorageOnce,
  requestPersistentStorage,
  getStoragePersistenceStatus,
} from '../storagePersistence';

describe('storagePersistence (DA-13)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('formatBytes', () => {
    it('formats bytes, kilobytes, megabytes, and gigabytes correctly', () => {
      expect(formatBytes(500)).toBe('500 B');
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1024 * 1024 * 5.5)).toBe('5.5 MB');
      expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe('2.50 GB');
    });
  });

  describe('requestPersistentStorageOnce and requestPersistentStorage', () => {
    it('calls navigator.storage.persist and records it in localStorage', async () => {
      const persistMock = vi.fn().mockResolvedValue(true);
      const persistedMock = vi.fn().mockResolvedValue(true);

      vi.stubGlobal('navigator', {
        storage: {
          persist: persistMock,
          persisted: persistedMock,
        },
      });

      const firstResult = await requestPersistentStorageOnce();
      expect(firstResult).toBe(true);
      expect(persistMock).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('storage_persist_requested')).toBe('true');

      // Second call should not call persist again, but persisted
      const secondResult = await requestPersistentStorageOnce();
      expect(secondResult).toBe(true);
      expect(persistMock).toHaveBeenCalledTimes(1);
      expect(persistedMock).toHaveBeenCalledTimes(1);
    });

    it('requestPersistentStorage forces call to navigator.storage.persist', async () => {
      const persistMock = vi.fn().mockResolvedValue(true);
      vi.stubGlobal('navigator', {
        storage: {
          persist: persistMock,
        },
      });

      localStorage.setItem('storage_persist_requested', 'true');
      const res = await requestPersistentStorage();
      expect(res).toBe(true);
      expect(persistMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStoragePersistenceStatus', () => {
    it('returns persisted and estimate info when available', async () => {
      vi.stubGlobal('navigator', {
        storage: {
          persist: vi.fn(),
          persisted: vi.fn().mockResolvedValue(true),
          estimate: vi.fn().mockResolvedValue({
            usage: 1024 * 1024 * 10,
            quota: 1024 * 1024 * 1024,
          }),
        },
      });

      const status = await getStoragePersistenceStatus();
      expect(status.supported).toBe(true);
      expect(status.persisted).toBe(true);
      expect(status.estimate).not.toBeNull();
      expect(status.estimate?.usageFormatted).toBe('10.0 MB');
      expect(status.estimate?.quotaFormatted).toBe('1.00 GB');
    });

    it('handles missing estimate gracefully', async () => {
      vi.stubGlobal('navigator', {
        storage: {
          persisted: vi.fn().mockResolvedValue(false),
        },
      });

      const status = await getStoragePersistenceStatus();
      expect(status.persisted).toBe(false);
      expect(status.estimate).toBeNull();
    });
  });
});
