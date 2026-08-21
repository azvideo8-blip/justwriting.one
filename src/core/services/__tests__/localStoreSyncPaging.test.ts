import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import {
  LocalStoreSyncService,
  splitStringIntoChunks,
  PAGE_SPLIT_THRESHOLD_BYTES,
} from '../LocalStoreSyncService';
import { DataProvider } from '../../data';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';

const USER = 'user_sync4_test';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 'test@example.com' }),
}));

vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (payload: Record<string, unknown>) => ({ ...payload, _encrypted: false }),
  maybeDecrypt: async (payload: Record<string, unknown>) => ({ ...payload, _encrypted: false }),
}));

describe('SYNC-4: LocalStoreSyncService and AIRestoreService paged records', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const db = await getLocalDb();
    await db.clear('aiDialogues');
  });

  describe('splitStringIntoChunks', () => {
    it('does not split string if within maxBytesPerChunk', () => {
      const text = 'Hello world, this is a small text.';
      const chunks = splitStringIntoChunks(text, 1000);
      expect(chunks).toEqual([text]);
    });

    it('splits large string and joins back byte-identical', () => {
      // Create a large repetitive string with multi-byte unicode characters (Russian text)
      const phrase = 'Привет, это длинное сообщение в диалоге с размышлениями ИИ и вариантами ответов! 🌟 ';
      const largeText = phrase.repeat(15000); // ~1.5 MB
      const maxBytes = 100 * 1024; // 100 KB chunks for test

      const chunks = splitStringIntoChunks(largeText, maxBytes);
      expect(chunks.length).toBeGreaterThan(10);

      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        expect(encoder.encode(chunk).length).toBeLessThanOrEqual(maxBytes);
      }

      const joined = chunks.join('');
      expect(joined).toBe(largeText);
    });
  });

  describe('Sync upload behavior', () => {
    it('uploads a record below 500 KB as a single row without page suffix', async () => {
      const db = await getLocalDb();
      const smallDialogue = {
        id: 'dialogue_small',
        guestId: USER,
        title: 'Небольшой диалог',
        messages: [{ id: 'm1', role: 'user', content: 'Привет', createdAt: 1000 }],
        updatedAt: 1000,
      };
      await db.put('aiDialogues', smallDialogue as never);

      const savedRecords: Array<{ key: string; payload: Record<string, unknown> }> = [];
      vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockImplementation(async (_u, _s, key, payload) => {
        savedRecords.push({ key, payload: payload as Record<string, unknown> });
      });
      const deletePagedSpy = vi.spyOn(DataProvider as Required<typeof DataProvider>, 'deleteLocalStorePagedRecords').mockResolvedValue(undefined as never);

      LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'dialogue_small');
      const { synced, failed } = await LocalStoreSyncService.flushPending(true);

      expect(synced).toBe(1);
      expect(failed).toBe(0);
      expect(savedRecords).toHaveLength(1);
      expect(savedRecords[0]!.key).toBe('dialogue_small');
      expect(savedRecords[0]!.payload.page).toBeUndefined();
      expect(savedRecords[0]!.payload.totalPages).toBeUndefined();
      expect(deletePagedSpy).toHaveBeenCalledWith(USER, 'aiDialogues', 'dialogue_small');
    });

    it('splits and uploads a record above 500 KB as multiple pages with page, totalPages, updatedAt', async () => {
      const db = await getLocalDb();
      // Generate a ~800 KB dialogue record
      const longMessage = 'Тестовое длинное рассуждение модели с множеством деталей и инсайтов. '.repeat(8000);
      const largeDialogue = {
        id: 'dialogue_large',
        guestId: USER,
        title: 'Большой диалог',
        messages: [
          { id: 'm1', role: 'user', content: 'Вопрос', createdAt: 1000 },
          { id: 'm2', role: 'assistant', content: 'Ответ', reasoning: longMessage, createdAt: 1001 },
        ],
        updatedAt: 2000,
      };
      await db.put('aiDialogues', largeDialogue as never);

      const savedRecords: Array<{ key: string; payload: Record<string, unknown> }> = [];
      vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockImplementation(async (_u, _s, key, payload) => {
        savedRecords.push({ key, payload: payload as Record<string, unknown> });
      });
      const deleteExactSpy = vi.spyOn(DataProvider as Required<typeof DataProvider>, 'deleteLocalStoreExactRecord').mockResolvedValue(undefined as never);

      LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'dialogue_large');
      const { synced, failed } = await LocalStoreSyncService.flushPending(true);

      expect(synced).toBe(1);
      expect(failed).toBe(0);
      expect(savedRecords.length).toBeGreaterThanOrEqual(2);

      const totalPages = savedRecords.length;
      for (let i = 0; i < totalPages; i++) {
        const pageRec = savedRecords[i]!;
        expect(pageRec.key).toBe(`dialogue_large#${i}`);
        expect(pageRec.payload.page).toBe(i);
        expect(pageRec.payload.totalPages).toBe(totalPages);
        expect(pageRec.payload.updatedAt).toBe(2000);
      }

      expect(deleteExactSpy).toHaveBeenCalledWith(USER, 'aiDialogues', 'dialogue_large');
    });

    it('deleting a record removes exact key and all paged records', async () => {
      const deleteRecordSpy = vi.spyOn(DataProvider, 'deleteLocalStoreRecord').mockResolvedValue(undefined as never);

      LocalStoreSyncService.scheduleStoreDelete('aiDialogues', 'dialogue_large');
      const { synced, failed } = await LocalStoreSyncService.flushPending(true);

      expect(synced).toBe(1);
      expect(failed).toBe(0);
      expect(deleteRecordSpy).toHaveBeenCalledWith(USER, 'aiDialogues', 'dialogue_large');
    });
  });

  describe('Restore reassembly and integrity checks', () => {
    it('restores multi-page record and reassembles exact original object in IndexedDB', async () => {
      const db = await getLocalDb();
      const originalDialogue = {
        id: 'dialogue_restore_test',
        guestId: USER,
        title: 'Восстановленный диалог',
        messages: [
          { id: 'm1', role: 'user', content: 'Привет', createdAt: 1000 },
          { id: 'm2', role: 'assistant', content: 'Ответ '.repeat(20000), reasoning: 'Мысли '.repeat(60000), createdAt: 1001 },
        ],
        updatedAt: 5000,
      };

      const fullJson = JSON.stringify(originalDialogue);
      const chunks = splitStringIntoChunks(fullJson, PAGE_SPLIT_THRESHOLD_BYTES);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      const cloudRecords = chunks.map((chunk, i) => ({
        store: 'aiDialogues',
        key: `dialogue_restore_test#${i}`,
        payload: {
          data: chunk,
          updatedAt: 5000,
          page: i,
          totalPages: chunks.length,
        },
      }));

      vi.spyOn(DataProvider, 'getLocalStoreRecords').mockResolvedValue(cloudRecords as never);
      vi.spyOn(DataProvider, 'getUserSummaries').mockResolvedValue([] as never);

      const res = await restoreAIDataFromCloud(USER);
      expect(res.localStoreRecords).toBe(1);
      expect(res.failed).toBe(0);

      const restored = await db.get('aiDialogues', 'dialogue_restore_test');
      expect(restored).toEqual(originalDialogue);
    });

    it('refuses an incomplete page set and leaves local copy untouched', async () => {
      const db = await getLocalDb();
      const localDialogue = {
        id: 'dialogue_incomplete_test',
        guestId: USER,
        title: 'Локальная копия (не должна пострадать)',
        messages: [{ id: 'm1', role: 'user', content: 'Локальное сообщение', createdAt: 1000 }],
        updatedAt: 1000,
      };
      await db.put('aiDialogues', localDialogue as never);

      // Cloud only has page 0 out of 2 (page 1 was dropped/missing)
      const cloudRecords = [
        {
          store: 'aiDialogues',
          key: 'dialogue_incomplete_test#0',
          payload: {
            data: '{"id":"dialogue_incomplete_test","title":"Облачная копия"',
            updatedAt: 2000,
            page: 0,
            totalPages: 2,
          },
        },
      ];

      vi.spyOn(DataProvider, 'getLocalStoreRecords').mockResolvedValue(cloudRecords as never);
      vi.spyOn(DataProvider, 'getUserSummaries').mockResolvedValue([] as never);

      const res = await restoreAIDataFromCloud(USER);
      expect(res.localStoreRecords).toBe(0);
      expect(res.failed).toBe(1);

      // Local copy is intact!
      const current = await db.get('aiDialogues', 'dialogue_incomplete_test');
      expect(current).toEqual(localDialogue);
    });

    it('refuses pages with mismatched updatedAt version stamps', async () => {
      const db = await getLocalDb();
      const localDialogue = {
        id: 'dialogue_version_mismatch',
        guestId: USER,
        title: 'Локальная копия',
        messages: [],
        updatedAt: 1000,
      };
      await db.put('aiDialogues', localDialogue as never);

      // Page 0 has updatedAt 2000, Page 1 has updatedAt 3000 (mixed passes)
      const cloudRecords = [
        {
          store: 'aiDialogues',
          key: 'dialogue_version_mismatch#0',
          payload: {
            data: 'chunk0',
            updatedAt: 2000,
            page: 0,
            totalPages: 2,
          },
        },
        {
          store: 'aiDialogues',
          key: 'dialogue_version_mismatch#1',
          payload: {
            data: 'chunk1',
            updatedAt: 3000,
            page: 1,
            totalPages: 2,
          },
        },
      ];

      vi.spyOn(DataProvider, 'getLocalStoreRecords').mockResolvedValue(cloudRecords as never);
      vi.spyOn(DataProvider, 'getUserSummaries').mockResolvedValue([] as never);

      const res = await restoreAIDataFromCloud(USER);
      expect(res.localStoreRecords).toBe(0);
      expect(res.failed).toBe(1);

      const current = await db.get('aiDialogues', 'dialogue_version_mismatch');
      expect(current).toEqual(localDialogue);
    });
  });
});
