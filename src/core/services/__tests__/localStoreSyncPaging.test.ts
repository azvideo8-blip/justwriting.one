import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import {
  LocalStoreSyncService,
  splitStringIntoChunks,
  PAGE_SPLIT_THRESHOLD_BYTES,
  MAX_RESTORE_RECORD_BYTES,
  PAGES_PER_REQUEST,
} from '../LocalStoreSyncService';
import { DataProvider } from '../../data';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';
import { sha256Hex } from '../../../features/ai/utils/embeddingIndexer';
import * as reportErrorModule from '../../../shared/errors/reportError';

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
    vi.spyOn(DataProvider, 'getUserEmbeddingsPaginated').mockResolvedValue({ items: [], readCount: 0 });
    // S-34: диалог перед выгрузкой читает облачную строку; здесь облако пусто.
    vi.spyOn(DataProvider, 'getLocalStoreRecord').mockResolvedValue(null);
    vi.spyOn(DataProvider as Required<typeof DataProvider>, 'getLocalStoreRecordPages').mockResolvedValue([]);
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
      // S-34: строки в облаке нет — диалог уходит условной вставкой.
      vi.spyOn(DataProvider, 'saveLocalStoreRecordIfUnchanged').mockImplementation(async (_u, _s, key, payload) => {
        savedRecords.push({ key, payload: payload as Record<string, unknown> });
        return true;
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
      const singleSaveSpy = vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockResolvedValue(undefined);
      const pagesSaveSpy = vi.spyOn(DataProvider, 'saveLocalStoreRecordPages').mockImplementation(async (_u, _s, pages) => {
        for (const p of pages) savedRecords.push({ key: p.key, payload: p.payload as Record<string, unknown> });
      });
      // S-49: манифест в строке `key` уходит последним, условной записью.
      const manifests: Array<{ key: string; payload: Record<string, unknown>; expected: number | null }> = [];
      vi.spyOn(DataProvider, 'saveLocalStoreRecordIfUnchanged').mockImplementation(async (_u, _s, key, payload, expected) => {
        manifests.push({ key, payload: payload as Record<string, unknown>, expected });
        return true;
      });
      const deleteStaleSpy = vi.spyOn(DataProvider as Required<typeof DataProvider>, 'deleteLocalStoreStalePages').mockResolvedValue(undefined as never);

      LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'dialogue_large');
      const { synced, failed } = await LocalStoreSyncService.flushPending(true);

      expect(synced).toBe(1);
      expect(failed).toBe(0);
      expect(savedRecords.length).toBeGreaterThanOrEqual(2);
      // Все страницы версии — одним запросом: по одной другое устройство видело
      // новую страницу 0 рядом со старой страницей 1 и отказывалось собирать запись.
      expect(pagesSaveSpy).toHaveBeenCalledTimes(1);
      expect(singleSaveSpy).not.toHaveBeenCalled();

      const totalPages = savedRecords.length;
      const stamp = (JSON.parse(JSON.stringify(await db.get('aiDialogues', 'dialogue_large'))) as { updatedAt: number }).updatedAt;
      // M-2: у попытки своя случайная метка — она же названа в манифесте.
      const nonce = manifests[0]?.payload.nonce;
      expect(typeof nonce).toBe('string');
      expect(String(nonce)).toMatch(/^[0-9a-f]{8}$/);
      for (let i = 0; i < totalPages; i++) {
        const pageRec = savedRecords[i]!;
        expect(pageRec.key).toBe(`dialogue_large#${stamp}#${nonce}#p${i}`);
        expect(pageRec.payload.page).toBe(i);
        expect(pageRec.payload.totalPages).toBe(totalPages);
        expect(pageRec.payload.updatedAt).toBe(stamp);
        expect(pageRec.payload.nonce).toBe(nonce);
        // M-3: текст страницы — в `chunk`, а не в `data`: строки без `data` клиенты
        // 0.9.28/0.9.29 пропускают, а не собирают в диалог поверх локального хода.
        expect(typeof pageRec.payload.chunk).toBe('string');
        expect(pageRec.payload.data).toBeUndefined();
      }

      // Манифест: строки в облаке не было — условная вставка; страницы прочих версий убраны.
      expect(manifests).toEqual([{ key: 'dialogue_large', payload: { manifest: true, updatedAt: stamp, totalPages, nonce }, expected: null }]);
      expect(deleteStaleSpy).toHaveBeenCalledWith(USER, 'aiDialogues', 'dialogue_large', stamp, nonce);
    });

    // R3-013: запись крупнее одного запроса (8 страниц) уходила несколькими —
    // сбой между ними оставлял в облаке смесь версий. Теперь она остаётся на
    // устройстве с отметкой, а не уходит по частям.
    it.each([
      ['~3.8 MB (8 pages) goes in one request', 3.8, 1],
      ['~4.5 MB stays on the device, never split across requests', 4.5, 0],
    ])('%s', async (_name, mb, calls) => {
      const db = await getLocalDb();
      const target = Math.floor(mb * 1024 * 1024);
      await db.put('aiDialogues', {
        id: 'dialogue_big', guestId: USER, title: 'Большой',
        messages: [{ id: 'm1', role: 'assistant', content: 'x'.repeat(target), createdAt: 1 }],
        updatedAt: 3000,
      } as never);
      vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockResolvedValue(undefined);
      const pagesSaveSpy = vi.spyOn(DataProvider, 'saveLocalStoreRecordPages').mockResolvedValue(undefined);
      vi.spyOn(DataProvider, 'saveLocalStoreRecordIfUnchanged').mockResolvedValue(true);
      vi.spyOn(DataProvider as Required<typeof DataProvider>, 'deleteLocalStoreStalePages').mockResolvedValue(undefined as never);

      LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'dialogue_big');
      const res = await LocalStoreSyncService.flushPending(true);

      expect(pagesSaveSpy).toHaveBeenCalledTimes(calls);
      for (const call of pagesSaveSpy.mock.calls) expect(call[2].length).toBeLessThanOrEqual(PAGES_PER_REQUEST);
      expect(res.skippedOversized ?? 0).toBe(calls === 0 ? 1 : 0);
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

    it('restores the newest complete version when an older, longer version left a stale page behind', async () => {
      // Диалог стал короче: версия 3000 занимает 2 страницы, а страница #2 от
      // версии 2000 (3 страницы) осталась в облаке. Раньше это давало
      // «Mixed version stamps» и отказ навсегда.
      const db = await getLocalDb();
      const fresh = { id: 'dialogue_shrunk', guestId: USER, title: 'Короче', messages: [], updatedAt: 3000 };
      const json = JSON.stringify(fresh);
      const half = Math.floor(json.length / 2);
      const cloudRecords = [
        { store: 'aiDialogues', key: 'dialogue_shrunk#0', payload: { data: json.slice(0, half), updatedAt: 3000, page: 0, totalPages: 2 } },
        { store: 'aiDialogues', key: 'dialogue_shrunk#2', payload: { data: 'stale tail', updatedAt: 2000, page: 2, totalPages: 3 } },
        { store: 'aiDialogues', key: 'dialogue_shrunk#1', payload: { data: json.slice(half), updatedAt: 3000, page: 1, totalPages: 2 } },
      ];
      vi.spyOn(DataProvider, 'getLocalStoreRecords').mockResolvedValue(cloudRecords as never);
      vi.spyOn(DataProvider, 'getUserSummaries').mockResolvedValue([] as never);

      const res = await restoreAIDataFromCloud(USER);
      expect(res.failed).toBe(0);
      expect(res.localStoreRecords).toBe(1);
      expect(await db.get('aiDialogues', 'dialogue_shrunk')).toMatchObject({ title: 'Короче', updatedAt: 3000 });
    });

    // AG-RESTORE-4: The longest dialogue cannot be restored and was called "malformed"
    it('restores a two-page record totalling ~941 KB and verifies its checksum (production shape)', async () => {
      const db = await getLocalDb();
      // Generate a synthetic ~941 KB dialogue record across 2 pages
      const targetBytes = 941 * 1024;
      const prefix = '{"id":"dialogue_9aee5b54","guestId":"' + USER + '","title":"Длинный диалог","messages":[{"id":"m1","role":"user","content":"Вопрос"},{"id":"m2","role":"assistant","content":"';
      const suffix = '"}],"updatedAt":6000}';
      const contentBytes = targetBytes - (new TextEncoder().encode(prefix).length + new TextEncoder().encode(suffix).length);
      const fullJson = prefix + 'X'.repeat(contentBytes) + suffix;
      const originalDialogue = JSON.parse(fullJson);

      const byteLength = new TextEncoder().encode(fullJson).length;
      expect(byteLength).toBe(941 * 1024);

      const chunks = splitStringIntoChunks(fullJson, PAGE_SPLIT_THRESHOLD_BYTES);
      expect(chunks.length).toBe(2);

      const checksum = await sha256Hex(fullJson);

      const cloudRecords = chunks.map((chunk, i) => ({
        store: 'aiDialogues',
        key: `dialogue_9aee5b54#${i}`,
        payload: {
          data: chunk,
          updatedAt: 6000,
          page: i,
          totalPages: chunks.length,
        },
        checksum: i === 0 ? checksum : undefined,
      }));

      vi.spyOn(DataProvider, 'getLocalStoreRecords').mockResolvedValue(cloudRecords as never);
      vi.spyOn(DataProvider, 'getUserSummaries').mockResolvedValue([] as never);

      const res = await restoreAIDataFromCloud(USER);
      expect(res.localStoreRecords).toBe(1);
      expect(res.failed).toBe(0);
      expect(res.oversized).toBe(0);

      const restored = await db.get('aiDialogues', 'dialogue_9aee5b54');
      expect(restored).toEqual(originalDialogue);
    });

    it('fails when checksum does not match on ~941 KB record after passing size gate', async () => {
      const reportErrorSpy = vi.spyOn(reportErrorModule, 'reportError');
      const targetBytes = 941 * 1024;
      const prefix = '{"id":"dialogue_bad_checksum","guestId":"' + USER + '","title":"Диалог с неверной чексуммой","messages":[{"id":"m1","role":"user","content":"';
      const suffix = '"}],"updatedAt":6000}';
      const contentBytes = targetBytes - (new TextEncoder().encode(prefix).length + new TextEncoder().encode(suffix).length);
      const fullJson = prefix + 'Y'.repeat(contentBytes) + suffix;

      const chunks = splitStringIntoChunks(fullJson, PAGE_SPLIT_THRESHOLD_BYTES);
      expect(chunks.length).toBe(2);

      const cloudRecords = chunks.map((chunk, i) => ({
        store: 'aiDialogues',
        key: `dialogue_bad_checksum#${i}`,
        payload: {
          data: chunk,
          updatedAt: 6000,
          page: i,
          totalPages: chunks.length,
        },
        checksum: i === 0 ? '0000000000000000000000000000000000000000000000000000000000000000' : undefined,
      }));

      vi.spyOn(DataProvider, 'getLocalStoreRecords').mockResolvedValue(cloudRecords as never);
      vi.spyOn(DataProvider, 'getUserSummaries').mockResolvedValue([] as never);

      const res = await restoreAIDataFromCloud(USER);
      expect(res.localStoreRecords).toBe(0);
      expect(res.failed).toBe(1);
      expect(reportErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('checksum mismatch') }),
        expect.objectContaining({ store: 'aiDialogues', key: 'dialogue_bad_checksum' })
      );
    });

    it('restores a record assembled from pages to just under MAX_RESTORE_RECORD_BYTES (~9.5 MB)', async () => {
      const db = await getLocalDb();
      const targetBytes = 9.5 * 1024 * 1024;
      const basePayload = '{"id":"dialogue_near_max","guestId":"' + USER + '","title":"Max Size","content":"';
      const suffix = '","updatedAt":7000}';
      const paddingLength = targetBytes - (basePayload.length + suffix.length);
      const jsonString = basePayload + 'A'.repeat(paddingLength) + suffix;

      const recordBytes = new TextEncoder().encode(jsonString).length;
      expect(recordBytes).toBeLessThan(MAX_RESTORE_RECORD_BYTES);
      expect(recordBytes).toBeGreaterThan(9 * 1024 * 1024);

      const chunks = splitStringIntoChunks(jsonString, PAGE_SPLIT_THRESHOLD_BYTES);
      expect(chunks.length).toBeGreaterThan(15);

      const cloudRecords = chunks.map((chunk, i) => ({
        store: 'aiDialogues',
        key: `dialogue_near_max#${i}`,
        payload: {
          data: chunk,
          updatedAt: 7000,
          page: i,
          totalPages: chunks.length,
        },
      }));

      vi.spyOn(DataProvider, 'getLocalStoreRecords').mockResolvedValue(cloudRecords as never);
      vi.spyOn(DataProvider, 'getUserSummaries').mockResolvedValue([] as never);

      const res = await restoreAIDataFromCloud(USER);
      expect(res.localStoreRecords).toBe(1);
      expect(res.failed).toBe(0);
      expect(res.oversized).toBe(0);

      const restored = (await db.get('aiDialogues', 'dialogue_near_max')) as unknown as { id: string; content: string };
      expect(restored).toBeDefined();
      expect(restored.id).toBe('dialogue_near_max');
    });

    it('reports oversized, never malformed, carrying both numbers for a record exceeding MAX_RESTORE_RECORD_BYTES', async () => {
      const db = await getLocalDb();
      const reportErrorSpy = vi.spyOn(reportErrorModule, 'reportError');

      // Target: 10.5 MB (> MAX_RESTORE_RECORD_BYTES)
      const targetBytes = 10.5 * 1024 * 1024;
      const basePayload = '{"id":"dialogue_too_large","title":"Too Large","content":"';
      const suffix = '","updatedAt":8000}';
      const paddingLength = targetBytes - (basePayload.length + suffix.length);
      const jsonString = basePayload + 'B'.repeat(paddingLength) + suffix;

      const recordBytes = new TextEncoder().encode(jsonString).length;
      expect(recordBytes).toBeGreaterThan(MAX_RESTORE_RECORD_BYTES);

      const chunks = splitStringIntoChunks(jsonString, PAGE_SPLIT_THRESHOLD_BYTES);
      const cloudRecords = chunks.map((chunk, i) => ({
        store: 'aiDialogues',
        key: `dialogue_too_large#${i}`,
        payload: {
          data: chunk,
          updatedAt: 8000,
          page: i,
          totalPages: chunks.length,
        },
      }));

      vi.spyOn(DataProvider, 'getLocalStoreRecords').mockResolvedValue(cloudRecords as never);
      vi.spyOn(DataProvider, 'getUserSummaries').mockResolvedValue([] as never);

      const res = await restoreAIDataFromCloud(USER);
      expect(res.localStoreRecords).toBe(0);
      expect(res.oversized).toBe(1);

      // Verify reportError call carries both measured size and limit
      expect(reportErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(new RegExp(`oversized.*${recordBytes}.*${MAX_RESTORE_RECORD_BYTES}`)),
        }),
        expect.objectContaining({
          store: 'aiDialogues',
          key: 'dialogue_too_large',
          bytes: recordBytes,
          limit: MAX_RESTORE_RECORD_BYTES,
        }),
        'warning'
      );

      // Verify that "malformed" is NEVER reported for an oversized record
      const malformedCall = reportErrorSpy.mock.calls.find(call => {
        const err = call[0];
        const msg = err instanceof Error ? err.message : String(err);
        return msg.includes('malformed');
      });
      expect(malformedCall).toBeUndefined();

      // Database is untouched
      const recordInDb = await db.get('aiDialogues', 'dialogue_too_large');
      expect(recordInDb).toBeUndefined();
    });

    it('reports malformed for a record that genuinely does not parse', async () => {
      const reportErrorSpy = vi.spyOn(reportErrorModule, 'reportError');

      const cloudRecords = [
        {
          store: 'aiDialogues',
          key: 'dialogue_corrupted_json',
          payload: {
            data: '{"id":"corrupted", title: broken json without quotes and truncated...',
            updatedAt: 9000,
          },
        },
      ];

      vi.spyOn(DataProvider, 'getLocalStoreRecords').mockResolvedValue(cloudRecords as never);
      vi.spyOn(DataProvider, 'getUserSummaries').mockResolvedValue([] as never);

      const res = await restoreAIDataFromCloud(USER);
      expect(res.localStoreRecords).toBe(0);
      expect(res.failed).toBe(1);
      expect(res.oversized).toBe(0);

      expect(reportErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'restoreAIData: malformed local_store_record' }),
        expect.objectContaining({ store: 'aiDialogues', key: 'dialogue_corrupted_json' })
      );
    });

    it('reports malformed for a parsed payload that is not an object or is an array', async () => {
      const reportErrorSpy = vi.spyOn(reportErrorModule, 'reportError');

      const cloudRecords = [
        {
          store: 'aiDialogues',
          key: 'dialogue_array_payload',
          payload: {
            data: JSON.stringify([{ id: 'not_an_object' }]),
            updatedAt: 9000,
          },
        },
      ];

      vi.spyOn(DataProvider, 'getLocalStoreRecords').mockResolvedValue(cloudRecords as never);
      vi.spyOn(DataProvider, 'getUserSummaries').mockResolvedValue([] as never);

      const res = await restoreAIDataFromCloud(USER);
      expect(res.localStoreRecords).toBe(0);
      expect(res.failed).toBe(1);

      expect(reportErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'restoreAIData: malformed local_store_record' }),
        expect.objectContaining({ store: 'aiDialogues', key: 'dialogue_array_payload' })
      );
    });

    it('restores aiThemeLedger record above the old 512 KB cap', async () => {
      const db = await getLocalDb();
      await db.clear('aiThemeLedger');
      const largeEvidence = 'Цитата из заметки для подкрепления темы. '.repeat(10000); // ~550 KB
      const themeRecord = {
        id: 'theme_large_evidence',
        theme: 'Работа над продуктом',
        tier: 'active',
        count: 542,
        evidence: [{ noteId: 'note-1', quote: largeEvidence }],
        updatedAt: 10000,
      };
      const themeJson = JSON.stringify(themeRecord);
      expect(new TextEncoder().encode(themeJson).length).toBeGreaterThan(512 * 1024);

      const chunks = splitStringIntoChunks(themeJson, PAGE_SPLIT_THRESHOLD_BYTES);
      const cloudRecords = chunks.map((chunk, i) => ({
        store: 'aiThemeLedger',
        key: `theme_large_evidence#${i}`,
        payload: {
          data: chunk,
          updatedAt: 10000,
          page: i,
          totalPages: chunks.length,
        },
      }));

      vi.spyOn(DataProvider, 'getLocalStoreRecords').mockResolvedValue(cloudRecords as never);
      vi.spyOn(DataProvider, 'getUserSummaries').mockResolvedValue([] as never);

      const res = await restoreAIDataFromCloud(USER);
      expect(res.localStoreRecords).toBe(1);
      expect(res.failed).toBe(0);
      expect(res.oversized).toBe(0);

      const restored = await db.get('aiThemeLedger', 'theme_large_evidence');
      expect(restored).toEqual(themeRecord);
    });
  });
});

