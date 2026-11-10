// Отчёт соседнего агента 06.11: сохранение из второй вкладки во время разбора конфликта
// исчезало: Pass 2 удалял версию, которую Pass 1 не видел и в форк не копировал.
import { afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { ProviderRecord } from '../../data/types';

const cloud = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  versions: new Map<string, Record<string, unknown>>(),
}));
const USER = 'user_conflict_concurrent_save';
const DOC = 'local_conflict_concurrent_save';
const CLOUD_DOC = 'cloud_conflict_concurrent_save';
const NEW_TEXT = 'SYNTHETIC fresh text saved while the conflict fork is being copied';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: 'user_conflict_concurrent_save', isAnonymous: false }),
  getCurrentUserId: () => 'user_conflict_concurrent_save',
}));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../data', () => ({
  DataProvider: {
    syncPush: async (items: unknown[]) => items.map(() => ({ status: 'ok' as const })),
    getDocument: vi.fn(async (_uid: string, id: string) => structuredClone(cloud.docs.get(id) ?? null)),
    getDocumentWithDeleted: vi.fn(async (_uid: string, id: string) => structuredClone(cloud.docs.get(id) ?? null)),
    getUserDocuments: vi.fn(async () => structuredClone([...cloud.docs.values()])),
    getVersions: vi.fn(async (_uid: string, id: string) => structuredClone(
      [...cloud.versions.values()].filter(v => v.documentId === id).sort((a, b) => Number(a.version) - Number(b.version)),
    )),
    createDocument: vi.fn(async (uid: string, data: ProviderRecord) => {
      const id = String(data.uuid);
      cloud.docs.set(id, { ...structuredClone(data), id, uuid: id, userId: uid, createdAt: Date.now(), updatedAt: Date.now() });
      return id;
    }),
    addVersion: vi.fn(async (uid: string, docId: string, id: string, data: ProviderRecord) => {
      cloud.versions.set(`${docId}:${data.version}`, { ...structuredClone(data), id, documentId: docId, userId: uid });
    }),
    updateDocument: vi.fn(async (_uid: string, id: string, data: ProviderRecord) => {
      cloud.docs.set(id, { ...cloud.docs.get(id), ...structuredClone(data), updatedAt: Date.now() });
    }),
    updateDocumentSessionMeta: vi.fn(async (_uid: string, id: string, data: ProviderRecord) => {
      const stamp = Date.now();
      cloud.docs.set(id, { ...cloud.docs.get(id), ...structuredClone(data), updatedAt: stamp });
      return stamp;
    }),
    deleteDraft: vi.fn(async () => undefined),
  },
}));

async function loadTab(key: CryptoKey | null) {
  const [storage, versions, localDb, sync, cryptoHelpers, encryption, sessionActions, storeActions, contentStore] = await Promise.all([
    import('../StorageService'),
    import('../LocalVersionService'),
    import('../../storage/localDb'),
    import('../SyncService'),
    import('../../crypto/cryptoHelpers'),
    import('../../crypto/encrypt'),
    import('../../../features/writing/utils/sessionActions'),
    import('../../../features/writing/store/storeActions'),
    import('../../../features/writing/store/useContentStore'),
  ]);
  cryptoHelpers.setProfileLoaded(USER, true);
  cryptoHelpers.setEncryptionEnabled(USER, key !== null);
  if (key) encryption.setSessionKey(key);
  return { ...storage, ...versions, ...localDb, ...sync, ...cryptoHelpers, ...sessionActions, ...storeActions, ...contentStore };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

const saveData = () => ({
  title: 'Synthetic concurrent note', content: NEW_TEXT, tags: [],
  wordCount: 12, duration: 10, wpm: 72, sessionStartedAt: new Date(3000),
});

/** В облаке под сейфом не бывает открытого текста (PLAINTEXT_UNDER_VAULT),
 *  поэтому фикстура отдаёт нагрузку так же, как это делает движок. */
async function atRest(tab: any, row: Record<string, unknown>, fields: string[], arrayFields: string[]) {
  return tab.getEncryptionEnabled(USER)
    ? await tab.maybeEncrypt(row, fields, arrayFields, USER)
    : row;
}

async function plainContentOf(tab: any, row: Record<string, unknown>) {
  const plain = await tab.maybeDecrypt({ ...row }, ['content'], []);
  return typeof plain.content === 'string' ? plain.content : null;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([false, true])('conflict fork versus another tab, encrypted=%s', encrypted => {
  it.each(['before', 'during', 'after'] as const)('preserves the save made %s fork copying, including after queue retry', async timing => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    cloud.docs.clear();
    cloud.versions.clear();
    const key = encrypted ? await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) : null;
    const tabA = await loadTab(key);
    // Separate module instances reproduce per-tab mutexes; IndexedDB remains shared.
    vi.resetModules();
    const tabB = await loadTab(key);
    expect(tabA.StorageService).not.toBe(tabB.StorageService);
    const db = await tabA.getLocalDb(USER);
    for (const store of ['documents', 'versions', 'syncQueue', 'profile', 'drafts'] as const) await db.clear(store);
    expect((await tabB.getLocalDb(USER)).name).toBe(db.name);

    await db.put('documents', {
      id: DOC, uuid: CLOUD_DOC, guestId: USER, title: 'Synthetic concurrent note',
      currentVersion: 2, lastSyncedCloudVersion: 1, linkedCloudId: CLOUD_DOC,
      totalWords: 2, totalDuration: 0, sessionsCount: 2, firstSessionAt: 1000, lastSessionAt: 2000, tags: [],
    });
    for (const [version, content] of [[1, 'SYNTHETIC base'], [2, 'SYNTHETIC old local edit']] as const) {
      await tabA.LocalVersionService.addVersion(USER, DOC, {
        content, previousContent: '', wordCount: 2, duration: 0, wpm: 0,
        versionNumber: version, sessionStartedAt: new Date(1000),
      });
    }
    cloud.docs.set(CLOUD_DOC, await atRest(tabA, {
      id: CLOUD_DOC, uuid: CLOUD_DOC, userId: USER, title: 'Synthetic concurrent note',
      currentVersion: 2, totalWords: 3, totalDuration: 0, sessionsCount: 2,
      firstSessionAt: 1000, lastSessionAt: 2000, createdAt: 1000, updatedAt: 2000, tags: [],
    }, ['title', 'mood'], ['tags']));
    for (const [version, content] of [[1, 'SYNTHETIC base'], [2, 'SYNTHETIC remote edit']] as const) {
      cloud.versions.set(`${CLOUD_DOC}:${version}`, await atRest(tabA, {
        id: `v${version}`, documentId: CLOUD_DOC, userId: USER, version, content,
        wordCount: 3, wordsAdded: 1, charsAdded: 1, duration: 0, wpm: 0,
        savedAt: 2000, sessionStartedAt: 1000, goalReached: false,
      }, ['content', 'mood'], []));
    }

    const paused = deferred();
    const resume = deferred();
    const realAddVersion = tabA.LocalVersionService.addVersion.bind(tabA.LocalVersionService);
    let intercepted = false;
    vi.spyOn(tabA.LocalVersionService, 'addVersion').mockImplementation(async (uid, docId, data) => {
      const result = await realAddVersion(uid, docId, data);
      if (timing === 'during' && docId !== DOC && !intercepted) {
        intercepted = true;
        paused.resolve();
        await resume.promise;
      }
      return result;
    });
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);

    if (timing === 'before') {
      online.mockReturnValue(false);
      await tabB.StorageService.saveVersion(USER, DOC, saveData());
      online.mockReturnValue(true);
    }
    const upload = tabA.StorageService.addCloudCopy(USER, DOC);
    if (timing === 'during') {
      try {
        await Promise.race([paused.promise, upload.then(() => { throw new Error('Fork copy was never intercepted'); })]);
        expect(await db.get('syncQueue', `lock_cloud_${DOC}`)).toBeDefined();
        const saved = await tabB.StorageService.saveVersion(USER, DOC, saveData());
        expect(saved).toMatchObject({ forked: false, cloudSynced: false, reason: 'LOCK_HELD' });
        expect((await db.getAll('versions')).some(v => v.content === NEW_TEXT)).toBe(true);
        expect((await db.get('documents', DOC))?.currentVersion).toBe(3);
        expect((await db.getAll('syncQueue')).some(t => t.documentId === DOC && !t.id.startsWith('lock_cloud_'))).toBe(true);
      } finally {
        resume.resolve();
      }
    }
    await expect(upload).resolves.toBe(CLOUD_DOC);
    if (timing === 'after') await tabB.StorageService.saveVersion(USER, DOC, saveData());

    const firstRetry = await tabA.SyncService.syncPending(USER, { force: true });
    const secondRetry = await tabA.SyncService.syncPending(USER, { force: true });
    expect(firstRetry.failed).toBe(0);
    expect(secondRetry.failed).toBe(0);
    const localVersions = await db.getAll('versions');
    const pending = await db.getAll('syncQueue');
    expect(pending).toHaveLength(0);
    const localCopies = localVersions.filter(v => v.content === NEW_TEXT).length;
    const cloudContents = await Promise.all(
      [...cloud.versions.values()].map(v => plainContentOf(tabA, v as Record<string, unknown>)),
    );
    const cloudCopies = cloudContents.filter(c => c === NEW_TEXT).length;
    const finalDoc = await db.get('documents', DOC);
    const newestLocal = Math.max(...localVersions.filter(v => v.documentId === DOC).map(v => v.version));
    expect(finalDoc?.currentVersion, 'The counter must not fall behind a kept version').toBeGreaterThanOrEqual(newestLocal);
    expect(localCopies, 'A successful local save must survive in the original or the conflict copy').toBeGreaterThan(0);
    expect(cloudCopies, 'Retry must upload the saved text, not drain a pointer to deleted data').toBeGreaterThan(0);
  });
});
