// `cleanupDraftsAfterSave` на настоящем мутаторе. Урок DW-5 (приёмка ревьюером):
// моки `WritingDraftService` не видят, что делает и чего НЕ делает `applyDelete`,
// поэтому здесь — настоящий `draftWriter` и `fake-indexeddb`, а мокается только
// край: облако (`DataProvider`) и очередь синка (`SyncService`).
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLocalDb, resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { cleanupDraftsAfterSave } from '../sessionActions';

const cloud = vi.hoisted(() => ({ deletes: 0, row: null as unknown }));

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => cloud.row,
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => { cloud.deletes++; cloud.row = null; },
  },
}));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    syncOne: vi.fn(async () => 'cloud_doc_id'),
    addToQueue: vi.fn(async () => undefined),
  },
}));

import { SyncService } from '../../../../core/services/SyncService';
import { getDraftGeneration, readTombstone } from '../../services/draftWriter';

const UID = 'u_session_actions';
const GUEST = 'guest_sa_test';

async function seedRow(uid: string, key: string, content: string): Promise<void> {
  const db = await getLocalDb(uid);
  await db.put('drafts', { userId: key, content, title: '', seconds: 10, wpm: 20, wordCount: 2, pinnedThoughts: [], tags: [], activeSessionId: null, updatedAt: Date.now() } as unknown as LocalDraft);
  localStorage.setItem(uid.startsWith('guest') ? STORAGE_KEYS.GUEST_DRAFT : STORAGE_KEYS.DRAFT(uid), JSON.stringify({ content }));
}

async function rowText(uid: string, key: string): Promise<string | null> {
  const db = await getLocalDb(uid);
  const row = await db.get('drafts', key) as LocalDraft | undefined;
  return row?.content ?? null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  cloud.deletes = 0;
  cloud.row = null;
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
});

describe('cleanupDraftsAfterSave (шаг 6: один вход удаления)', () => {
  it('аккаунт: оба локальных адреса чищены, надгробие живо, досылка отмечена, синк сделан', async () => {
    await seedRow(UID, UID, 'набранный текст');
    const epochBefore = getDraftGeneration(UID);

    const res = await cleanupDraftsAfterSave(UID, false, 'doc456');

    expect(await rowText(UID, UID), 'строка `drafts` не удалена').toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(UID)), 'LS-дубль не снят').toBeNull();
    expect(getDraftGeneration(UID), 'эпоху поднял мутатор').toBeGreaterThan(epochBefore);
    expect(readTombstone(UID)?.hashes.length, 'надгробие без хэша удалённого').toBeGreaterThan(0);
    expect(cloud.deletes, 'облачная половина не снесена').toBe(1);
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(UID)), 'удачное облако обязано снять отметку').toBeNull();
    expect(SyncService.addToQueue).toHaveBeenCalledWith('doc456', UID);
    expect(SyncService.syncOne).toHaveBeenCalledWith(UID, 'doc456');
    expect(res.cloudSynced).toBe(true);
  });

  it('без docIdToSync: удаление всё равно исполняется, синк не зовётся', async () => {
    await seedRow(UID, UID, 'текст без привязки');
    await cleanupDraftsAfterSave(UID, false, null);
    expect(await rowText(UID, UID)).toBeNull();
    expect(SyncService.syncOne).not.toHaveBeenCalled();
    expect(SyncService.addToQueue).not.toHaveBeenCalled();
  });

  it('офлайн: локальная половина сделана, облако не тронуто, отметка досылки держится', async () => {
    await seedRow(UID, UID, 'офлайн-финиш');
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const res = await cleanupDraftsAfterSave(UID, false, 'doc789');
      expect(await rowText(UID, UID)).toBeNull();
      expect(cloud.deletes, 'RA1-2: без сети облако не трогается').toBe(0);
      expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(UID)), 'BR-1а: отметка обязана остаться').not.toBeNull();
      expect(res.cloudSynced).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('отказ syncOne не роняет финиш: заметка остаётся в очереди', async () => {
    vi.mocked(SyncService.syncOne).mockRejectedValueOnce(new Error('Network error'));
    await expect(cleanupDraftsAfterSave(UID, false, 'doc456')).resolves.not.toThrow();
    await vi.waitFor(() => expect(SyncService.addToQueue).toHaveBeenCalledWith('doc456', UID));
  });

  it('отказ addToQueue — тоже не исключение наружу', async () => {
    vi.mocked(SyncService.syncOne).mockRejectedValueOnce(new Error('Network error'));
    vi.mocked(SyncService.addToQueue).mockRejectedValueOnce(new Error('Database error'));
    await expect(cleanupDraftsAfterSave(UID, false, 'doc456')).resolves.not.toThrow();
  });

  it('гость: оба гостевых адреса чищены, надгробия и облака нет (D6)', async () => {
    await seedRow(GUEST, 'guest_draft', 'гостевой текст');
    await cleanupDraftsAfterSave(GUEST, true, null);
    const guestDb = await getLocalDb(GUEST);
    expect(await guestDb.get('drafts', 'guest_draft'), 'строка `guest_draft` осталась').toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT), 'ключ `jw_guest_draft` остался').toBeNull();
    expect(readTombstone(GUEST), 'гостю надгробие не пишут').toBeNull();
    expect(cloud.deletes).toBe(0);
  });
});
