import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VersionService } from '../../../../core/services/VersionService';
import { DataProvider } from '../../../../core/data';

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    addVersion: vi.fn(),
    getVersions: vi.fn(),
    getLatestVersion: vi.fn(),
  },
}));

vi.mock('../../../../core/services/DiffService', () => ({
  computeWordDelta: () => ({ wordsAdded: 10, charsAdded: 50 }),
}));

describe('VersionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addVersion', () => {
    it('computes diff and calls DataProvider.addVersion', async () => {
      vi.mocked(DataProvider.addVersion).mockResolvedValue();
      const id = await VersionService.addVersion('u1', 'doc1', {
        content: 'new',
        previousContent: 'old',
        wordCount: 1,
        duration: 10,
        wpm: 6,
        versionNumber: 2,
        sessionStartedAt: new Date(1000)
      });
      
      expect(id).toBe('v2');
      expect(DataProvider.addVersion).toHaveBeenCalledWith('u1', 'doc1', 'v2', expect.objectContaining({
        content: 'new',
        version: 2,
        wordCount: 1,
        wordsAdded: 10,
        charsAdded: 50
      }));
    });

    it('rejects if estimated doc size exceeds 900_000', async () => {
      const hugeContent = 'a'.repeat(400_000);
      const hugePrev = 'b'.repeat(300_000);
      await expect(
        VersionService.addVersion('u1', 'doc1', {
          content: hugeContent,
          previousContent: hugePrev,
          wordCount: 1,
          duration: 1,
          wpm: 1,
          versionNumber: 1,
          sessionStartedAt: new Date()
        })
      ).rejects.toThrow(/Document too large/);
    });
  });

  describe('getVersions', () => {
    it('returns sorted versions', async () => {
      vi.mocked(DataProvider.getVersions).mockResolvedValue([
        { id: 'v2', version: 2, content: 'new', wordCount: 2, duration: 2, wpm: 2, wordsAdded: 2, charsAdded: 2, goalReached: false, savedAt: 2000, sessionStartedAt: 2000, documentId: 'doc1' },
        { id: 'v1', version: 1, content: 'old', wordCount: 1, duration: 1, wpm: 1, wordsAdded: 1, charsAdded: 1, goalReached: false, savedAt: 1000, sessionStartedAt: 1000, documentId: 'doc1' }
      ]);
      const versions = await VersionService.getVersions('u1', 'doc1');
      expect(versions).toHaveLength(2);
      expect(versions[0]?.version).toBe(1);
      expect(versions[0]?.version).toBe(1);
      expect(versions[1]?.version).toBe(2);
    });

    it('returns fallback objects for versions failing validation', async () => {
      vi.mocked(DataProvider.getVersions).mockResolvedValue([
        { id: 'ver_1', version: 1, content: 'valid', wordCount: 1, duration: 1, wpm: 1, wordsAdded: 1, charsAdded: 1, goalReached: false, savedAt: 1000, sessionStartedAt: 1000, documentId: 'doc1' },
        { id: 'ver_corrupted', version: 'not-a-number' as unknown as number, content: 'corrupt', wordCount: 0, duration: 0, wpm: 0, wordsAdded: 0, charsAdded: 0, goalReached: false, savedAt: 2000, sessionStartedAt: 2000, documentId: 'doc1' }
      ]);
      const versions = await VersionService.getVersions('u1', 'doc1');
      expect(versions).toHaveLength(2);
      const corrupted = versions.find(v => v.id === 'ver_corrupted');
      // #45: деградированная запись типобезопасна — мусорная версия заменяется
      // дефолтом, а флаг _degraded честно помечает её в UI.
      expect(corrupted).toBeDefined();
      expect(corrupted?.version).toBe(0);
      expect(corrupted?._degraded).toBe(true);
      const healthy = versions.find(v => v.id === 'ver_1');
      expect(healthy?._degraded).toBeUndefined();
    });
  });

  describe('getLatestContent', () => {
    it('returns content of the latest version', async () => {
      vi.mocked(DataProvider.getLatestVersion).mockResolvedValue({ id: 'v2', version: 2, content: 'latest', wordCount: 2, duration: 2, wpm: 2, wordsAdded: 2, charsAdded: 2, goalReached: false, savedAt: 2000, sessionStartedAt: 2000, documentId: 'doc1' });
      const content = await VersionService.getLatestContent('u1', 'doc1');
      expect(content).toBe('latest');
    });

    it('returns empty string if no latest version', async () => {
      vi.mocked(DataProvider.getLatestVersion).mockResolvedValue(null);
      const content = await VersionService.getLatestContent('u1', 'doc1');
      expect(content).toBe('');
    });

    it('returns empty string if parsing fails', async () => {
      vi.mocked(DataProvider.getLatestVersion).mockResolvedValue({ id: 'ver_invalid', version: 'invalid' as unknown as number, content: 'invalid content', wordCount: 2, duration: 2, wpm: 2, wordsAdded: 2, charsAdded: 2, goalReached: false, savedAt: 2000, sessionStartedAt: 2000, documentId: 'doc1' });
      const content = await VersionService.getLatestContent('u1', 'doc1');
      expect(content).toBe('');
    });
  });

  describe('getLatestVersion', () => {
    it('returns latest version object', async () => {
      vi.mocked(DataProvider.getLatestVersion).mockResolvedValue({ id: 'v2', version: 2, content: 'latest', wordCount: 2, duration: 2, wpm: 2, wordsAdded: 2, charsAdded: 2, goalReached: false, savedAt: 2000, sessionStartedAt: 2000, documentId: 'doc1' });
      const version = await VersionService.getLatestVersion('u1', 'doc1');
      expect(version?.content).toBe('latest');
      expect(version?.version).toBe(2);
    });

    it('returns null if no versions exist', async () => {
      vi.mocked(DataProvider.getLatestVersion).mockResolvedValue(null);
      const version = await VersionService.getLatestVersion('u1', 'doc1');
      expect(version).toBeNull();
    });

    it('returns null if parsing fails', async () => {
      vi.mocked(DataProvider.getLatestVersion).mockResolvedValue({ id: 'ver_invalid', version: 'invalid' as unknown as number, content: 'invalid content', wordCount: 2, duration: 2, wpm: 2, wordsAdded: 2, charsAdded: 2, goalReached: false, savedAt: 2000, sessionStartedAt: 2000, documentId: 'doc1' });
      const version = await VersionService.getLatestVersion('u1', 'doc1');
      expect(version).toBeNull();
    });
  });
});
