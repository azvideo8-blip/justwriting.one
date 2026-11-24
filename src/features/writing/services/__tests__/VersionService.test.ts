import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VersionService } from '../../../../core/services/VersionService';
import { DataProvider } from '../../../../core/data';
import * as cryptoHelpers from '../../../../core/crypto/cryptoHelpers';

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

    it('rejects plaintext whose character count exceeds MAX_VERSION_CONTENT_CHARS', async () => {
      const hugeContent = 'a'.repeat(700_001);
      await expect(
        VersionService.addVersion('u1', 'doc1', {
          content: hugeContent,
          previousContent: '',
          wordCount: 1,
          duration: 1,
          wpm: 1,
          versionNumber: 1,
          sessionStartedAt: new Date()
        })
      ).rejects.toThrow(/Document too large/);
    });

    it('T-3: accepts a plaintext note the server accepts — 400k Cyrillic chars is 800 KB of UTF-8 but 400k characters', async () => {
      vi.spyOn(cryptoHelpers, 'getEncryptionEnabled').mockReturnValue(false);
      vi.mocked(DataProvider.addVersion).mockResolvedValue();
      // previousContent is not stored in versions.content; it must not count.
      await expect(
        VersionService.addVersion('u1', 'doc1', {
          content: 'я'.repeat(400_000),
          previousContent: 'я'.repeat(300_000),
          wordCount: 1,
          duration: 1,
          wpm: 1,
          versionNumber: 1,
          sessionStartedAt: new Date()
        })
      ).resolves.toBe('v1');
    });

    it('T-3: rejects under vault if estimated ciphertext exceeds MAX_VERSION_CONTENT_CHARS (300k Cyrillic chars)', async () => {
      vi.spyOn(cryptoHelpers, 'getEncryptionEnabled').mockReturnValue(true);
      const cyrillicContent = 'я'.repeat(300_000);
      await expect(
        VersionService.addVersion('u1', 'doc1', {
          content: cyrillicContent,
          previousContent: '',
          wordCount: 300_000,
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

  describe('getLatestVersion', () => {
    it('returns latest version object', async () => {
      vi.mocked(DataProvider.getLatestVersion).mockResolvedValue({ id: 'v2', version: 2, content: 'latest', wordCount: 2, duration: 2, wpm: 2, wordsAdded: 2, charsAdded: 2, goalReached: false, savedAt: 2000, sessionStartedAt: 2000, documentId: 'doc1' });
      const version = await VersionService.getLatestVersion('u1', 'doc1');
      expect(version).not.toBe('PARSE_FAILED');
      expect((version as { content: string }).content).toBe('latest');
      expect((version as { version: number }).version).toBe(2);
    });

    it('returns null if no versions exist', async () => {
      vi.mocked(DataProvider.getLatestVersion).mockResolvedValue(null);
      const version = await VersionService.getLatestVersion('u1', 'doc1');
      expect(version).toBeNull();
    });

    it("returns 'PARSE_FAILED' if parsing fails (AUD-5)", async () => {
      vi.mocked(DataProvider.getLatestVersion).mockResolvedValue({ id: 'ver_invalid', version: 'invalid' as unknown as number, content: 'invalid content', wordCount: 2, duration: 2, wpm: 2, wordsAdded: 2, charsAdded: 2, goalReached: false, savedAt: 2000, sessionStartedAt: 2000, documentId: 'doc1' });
      const version = await VersionService.getLatestVersion('u1', 'doc1');
      expect(version).toBe('PARSE_FAILED');
    });
  });
});
