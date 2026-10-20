import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { SyncService } from '../SyncService';
import { LocalDocumentService } from '../LocalDocumentService';
import { LocalVersionService } from '../LocalVersionService';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';
import { ConflictResolver } from '../ConflictResolver';
import { getLocalDb } from '../../storage/localDb';
import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';

// AUDIT-5.2: главный инвариант движка — «один локальный документ = один
// облачный, ноль форков в мирном пути». Все найденные аудитом баги (H3,
// MH4, MH5) были нарушениями именно его. Тест гоняет ПОЛНЫЙ цикл:
// офлайн-заметка -> очередь -> drain -> облако, с облачной стороной на
// in-memory шпионах (как agSync5).

describe('Sync cycle invariant (AUDIT-5.2)', () => {
  const userId = 'user_cycle';

  // In-memory облако.
  let cloudDocs: Map<string, Record<string, unknown>>;
  let cloudVersions: Map<string, Array<Record<string, unknown>>>;
  let nextCloudId: number;
  let conflictCalls: number;

  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    setProfileLoaded(userId, true);
    setEncryptionEnabled(userId, false);
    const db = await getLocalDb(userId);
    const tx = db.transaction(['documents', 'versions', 'syncQueue'], 'readwrite');
    await Promise.all([
      tx.objectStore('documents').clear(),
      tx.objectStore('versions').clear(),
      tx.objectStore('syncQueue').clear(),
      tx.done,
    ]);

    cloudDocs = new Map();
    cloudVersions = new Map();
    nextCloudId = 1;
    conflictCalls = 0;

    vi.spyOn(DocumentService, 'getUserDocuments').mockImplementation(
      async () => Array.from(cloudDocs.values()) as never,
    );
    vi.spyOn(DocumentService, 'createDocument').mockImplementation(async (_uid, data) => {
      const id = `cloud_${nextCloudId++}`;
      cloudDocs.set(id, {
        id,
        title: data?.title ?? '',
        currentVersion: 0,
        totalWords: 0,
        totalDuration: 0,
        sessionsCount: 0,
        firstSessionAt: data?.firstSessionAt ?? null,
        lastSessionAt: data?.lastSessionAt ?? null,
      });
      return id;
    });
    // S0-4: после выгрузки движок перечитывает живой ряд — серверная метка
    // `updated_at` нужна для отметки «до какой версии выгружено».
    vi.spyOn(DocumentService, 'getDocument').mockImplementation(async (_uid, id) => {
      const doc = cloudDocs.get(id);
      return (doc ? { ...doc, updatedAt: doc.updatedAt ?? new Date().toISOString() } : null) as never;
    });
    vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockImplementation(async (_uid, id, patch) => {
      const doc = cloudDocs.get(id);
      if (doc) Object.assign(doc, patch);
      return null;
    });
    vi.spyOn(VersionService, 'getVersions').mockImplementation(async (_uid, cloudId) =>
      (cloudVersions.get(cloudId) ?? []) as never,
    );
    vi.spyOn(VersionService, 'addVersion').mockImplementation(async (_uid, cloudId, ver) => {
      const list = cloudVersions.get(cloudId) ?? [];
      list.push({ ...ver } as Record<string, unknown>);
      cloudVersions.set(cloudId, list);
      const doc = cloudDocs.get(cloudId);
      if (doc) doc['currentVersion'] = Math.max(Number(doc['currentVersion'] ?? 0), ver.versionNumber);
      return `v${ver.versionNumber}`;
    });
    vi.spyOn(ConflictResolver, 'resolveConflict').mockImplementation(async () => {
      conflictCalls++;
      return { forked: true };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('full cycle: offline note -> queue -> syncAllUnlinked -> one cloud doc with all versions, no forks', async () => {
    // 1. Офлайн-заметка: два сеанса = две версии.
    const localId = await LocalDocumentService.createDocument(userId, {
      title: 'Synthetic cycle note',
      tags: [],
      firstSessionAt: new Date('2026-08-24T10:00:00Z').getTime(),
    });
    await LocalVersionService.addVersion(userId, localId, {
      content: 'first session text',
      previousContent: '',
      wordCount: 3, wpm: 0,
      duration: 60,
      versionNumber: 1,
      sessionStartedAt: new Date('2026-08-24T10:00:00Z'),
    });
    await LocalVersionService.addVersion(userId, localId, {
      content: 'first session text second session',
      previousContent: 'first session text',
      wordCount: 5, wpm: 0,
      duration: 120,
      versionNumber: 2,
      sessionStartedAt: new Date('2026-08-24T11:00:00Z'),
    });

    // 2. Выгрузка.
    const result = await SyncService.syncAllUnlinked(userId);

    // Инвариант: ровно один облачный документ, все версии на месте.
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    expect(cloudDocs.size).toBe(1);
    expect(conflictCalls).toBe(0);

    const [cloudDoc] = cloudDocs.values();
    const versions = cloudVersions.get(cloudDoc!['id'] as string) ?? [];
    expect(versions.map(v => v.versionNumber)).toEqual([1, 2]);
    expect(versions[1]!.content).toBe('first session text second session');

    // Локальная копия слинкована, очередь пуста.
    const linked = await LocalDocumentService.getDocument(localId, userId);
    expect(linked?.linkedCloudId).toBe(cloudDoc!['id']);
    expect(await SyncService.getPendingCount(userId)).toBe(0);
  });

  it('second sync of a linked note does not create a second cloud document', async () => {
    const localId = await LocalDocumentService.createDocument(userId, {
      title: 'Synthetic idempotent note',
      tags: [],
    });
    await LocalVersionService.addVersion(userId, localId, {
      content: 'only session',
      previousContent: '',
      wordCount: 2,
      duration: 30,
      wpm: 0,
      versionNumber: 1,
      sessionStartedAt: new Date('2026-08-24T10:00:00Z'),
    });

    await SyncService.syncAllUnlinked(userId);
    expect(cloudDocs.size).toBe(1);

    // Повторный проход по уже слинкованной заметке ничего не создаёт.
    await LocalDocumentService.updateDocument(localId, { totalWords: 2 }, userId);
    const second = await SyncService.syncAllUnlinked(userId);
    expect(second.synced).toBe(0);
    expect(conflictCalls).toBe(0);
    expect(cloudDocs.size).toBe(1);
  });
});
