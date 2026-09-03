import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

// Mock cloud storage
interface CloudDoc {
  id: string;
  uuid: string;
  currentVersion: number;
  totalWords: number;
  totalDuration: number;
  title: string;
}
interface CloudVersion {
  id: string;
  documentId: string;
  version: number;
  content: string;
  wordCount: number;
  duration: number;
  wpm: number;
  sessionStartedAt?: Date;
  savedAt?: Date;
}

const mockCloudDocs = new Map<string, CloudDoc>();
const mockCloudVersions = new Map<string, CloudVersion[]>();

vi.mock('../VersionService', () => ({
  VersionService: {
    getVersions: vi.fn(async (_userId: string, cloudId: string) => {
      return mockCloudVersions.get(cloudId) || [];
    }),
    addVersion: vi.fn(async (_userId: string, cloudId: string, data: any) => {
      const list = mockCloudVersions.get(cloudId) || [];
      const newVer: CloudVersion = {
        id: `cver_${data.versionNumber}`,
        documentId: cloudId,
        version: data.versionNumber,
        content: data.content,
        wordCount: data.wordCount,
        duration: data.duration,
        wpm: data.wpm,
        sessionStartedAt: data.sessionStartedAt,
        savedAt: data.savedAt,
      };
      list.push(newVer);
      mockCloudVersions.set(cloudId, list);
      return newVer.id;
    }),
  },
}));

vi.mock('../DocumentService', () => ({
  DocumentService: {
    getDocument: vi.fn(async (_userId: string, cloudId: string) => {
      return mockCloudDocs.get(cloudId) || null;
    }),
    getDocumentWithDeleted: vi.fn(async (_userId: string, cloudId: string) => {
      return mockCloudDocs.get(cloudId) || null;
    }),
    updateDocumentAfterSession: vi.fn(async (_userId: string, cloudId: string, stats: any) => {
      const doc = mockCloudDocs.get(cloudId);
      if (doc) {
        doc.currentVersion = stats.currentVersion;
        doc.totalWords = stats.totalWords;
        doc.totalDuration = stats.totalDuration ?? doc.totalDuration;
      }
    }),
  },
}));

import { CloudSyncService } from '../CloudSyncService';
import { ConflictResolver } from '../ConflictResolver';
import { LocalDocumentService } from '../LocalDocumentService';
import { LocalVersionService } from '../LocalVersionService';
import { LocalStorageService } from '../LocalStorageService';
import { getLocalDb } from '../../storage/localDb';
import { setProfileLoaded, setEncryptionEnabled } from '../../crypto/cryptoHelpers';

const USER = 'user_sync0';
const CLOUD_ID = 'cloud_note_sync0';

beforeEach(async () => {
  vi.clearAllMocks();
  mockCloudDocs.clear();
  mockCloudVersions.clear();
  setProfileLoaded(USER, true);
  setEncryptionEnabled(USER, false);

  const db = await getLocalDb();
  const tx = db.transaction(['documents', 'versions', 'syncQueue'], 'readwrite');
  await tx.objectStore('documents').clear();
  await tx.objectStore('versions').clear();
  await tx.objectStore('syncQueue').clear();
  await tx.done;
});

describe('SYNC-0: Cross-device divergence and fast-forward invariants', () => {
  it('Condition 1 & 3: Same base, two divergent edits → forks and aligns original with cloud', async () => {
    const conflictSpy = vi.spyOn(ConflictResolver, 'resolveConflict');

    // 1. Cloud has Note X at v1
    mockCloudDocs.set(CLOUD_ID, {
      id: CLOUD_ID,
      uuid: CLOUD_ID,
      currentVersion: 1,
      totalWords: 2,
      totalDuration: 10,
      title: 'Original Title',
    });
    mockCloudVersions.set(CLOUD_ID, [
      {
        id: 'cver_1',
        documentId: CLOUD_ID,
        version: 1,
        content: 'Initial text',
        wordCount: 2,
        duration: 10,
        wpm: 12,
      },
    ]);

    // 2. Device A edited v1 -> v2 in cloud ("Text from Device A")
    mockCloudDocs.get(CLOUD_ID)!.currentVersion = 2;
    mockCloudDocs.get(CLOUD_ID)!.totalWords = 5;
    mockCloudVersions.get(CLOUD_ID)!.push({
      id: 'cver_2',
      documentId: CLOUD_ID,
      version: 2,
      content: 'Text from Device A',
      wordCount: 5,
      duration: 20,
      wpm: 15,
    });

    // 3. Device B has Note X locally at v1, and edited it to "Text from Device B"
    const db = await getLocalDb();
    const localDocId = 'local_doc_b';
    await db.put('documents', {
      id: localDocId,
      guestId: USER,
      title: 'Original Title',
      currentVersion: 1,
      linkedCloudId: CLOUD_ID,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      totalWords: 2,
      totalDuration: 10,
      sessionsCount: 1,
      tags: [],
    } as any);

    await db.put('versions', {
      id: 'local_ver_1',
      documentId: localDocId,
      guestId: USER,
      version: 1,
      content: 'Initial text',
      wordCount: 2,
      duration: 10,
      wpm: 12,
      sessionStartedAt: 1000,
      savedAt: 1000,
    } as any);

    // Save v2 locally on Device B (as saveVersionToLocal does in production)
    await db.put('versions', {
      id: 'local_ver_2_b',
      documentId: localDocId,
      guestId: USER,
      version: 2,
      content: 'Text from Device B',
      wordCount: 5,
      duration: 30,
      wpm: 15,
      sessionStartedAt: 2000,
      savedAt: 2000,
    } as any);

    // Device B calls syncVersionToCloud with newVersion = 2, prevContent = 'Initial text'
    const syncResult = await CloudSyncService.syncVersionToCloud(
      USER,
      localDocId,
      CLOUD_ID,
      {
        title: 'Original Title',
        content: 'Text from Device B',
        wordCount: 5,
        documentWordCount: 5,
        duration: 30,
        wpm: 15,
        sessionStartedAt: new Date(2000),
      } as any,
      2,
      'Initial text'
    );

    // A. Assert conflict resolution was invoked
    expect(conflictSpy).toHaveBeenCalled();
    expect(syncResult.forked).toBe(true);
    expect(syncResult.forkTitle).toBeDefined();

    // B. Assert a fork document was created carrying Device B's work
    const allDocs = await LocalDocumentService.getGuestDocuments(USER);
    expect(allDocs).toHaveLength(2); // Original doc + Fork doc
    const forkDoc = allDocs.find(d => d.id !== localDocId)!;
    expect(forkDoc).toBeDefined();

    const forkVersions = await LocalVersionService.getVersions(forkDoc.id);
    expect(forkVersions).toHaveLength(1);
    expect(forkVersions[0]!.content).toBe('Text from Device B');

    // C. Condition 3: Assert the original document yields the head and aligns with the cloud
    const origVersions = await LocalVersionService.getVersions(localDocId);
    expect(origVersions).toHaveLength(2);
    expect(origVersions[0]!.version).toBe(1);
    expect(origVersions[0]!.content).toBe('Initial text');
    expect(origVersions[1]!.version).toBe(2);
    expect(origVersions[1]!.content).toBe('Text from Device A'); // Reconciled with cloud head!

    const updatedOrigDoc = await LocalStorageService.getDocument(localDocId);
    expect(updatedOrigDoc?.currentVersion).toBe(2);

    // D. Assert cloud was not silently overwritten
    const cloudVersions = mockCloudVersions.get(CLOUD_ID)!;
    expect(cloudVersions).toHaveLength(2);
    expect(cloudVersions[1]!.content).toBe('Text from Device A');
    expect(mockCloudDocs.get(CLOUD_ID)!.currentVersion).toBe(2);
  });

  it('Condition 1 & Test 2: Genuine fast-forward (B base is A v2) → uploads as v3 with NO fork', async () => {
    const conflictSpy = vi.spyOn(ConflictResolver, 'resolveConflict');

    // Cloud has v1 ("Initial text") and v2 ("Text from Device A")
    mockCloudDocs.set(CLOUD_ID, {
      id: CLOUD_ID,
      uuid: CLOUD_ID,
      currentVersion: 2,
      totalWords: 5,
      totalDuration: 30,
      title: 'Original Title',
    });
    mockCloudVersions.set(CLOUD_ID, [
      { id: 'cver_1', documentId: CLOUD_ID, version: 1, content: 'Initial text', wordCount: 2, duration: 10, wpm: 12 },
      { id: 'cver_2', documentId: CLOUD_ID, version: 2, content: 'Text from Device A', wordCount: 5, duration: 20, wpm: 15 },
    ]);

    const db = await getLocalDb();
    const localDocId = 'local_doc_ff';
    await db.put('documents', {
      id: localDocId,
      guestId: USER,
      title: 'Original Title',
      currentVersion: 1, // Local counter was lagging
      linkedCloudId: CLOUD_ID,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      totalWords: 2,
      totalDuration: 10,
      sessionsCount: 1,
      tags: [],
    } as any);

    // Device B edited on top of "Text from Device A": prevContent is the cloud head!
    const syncResult = await CloudSyncService.syncVersionToCloud(
      USER,
      localDocId,
      CLOUD_ID,
      {
        title: 'Original Title',
        content: 'Text from Device A + edit from B',
        wordCount: 10,
        documentWordCount: 10,
        duration: 30,
        wpm: 20,
        sessionStartedAt: new Date(3000),
      } as any,
      2, // Local device thought it was creating version 2
      'Text from Device A' // prevContent matches cloud head!
    );

    expect(conflictSpy).not.toHaveBeenCalled();
    expect(syncResult.forked).toBe(false);

    // Uploaded as version 3
    const cloudVersions = mockCloudVersions.get(CLOUD_ID)!;
    expect(cloudVersions).toHaveLength(3);
    expect(cloudVersions[2]!.version).toBe(3);
    expect(cloudVersions[2]!.content).toBe('Text from Device A + edit from B');
    expect(mockCloudDocs.get(CLOUD_ID)!.currentVersion).toBe(3);

    // Only 1 document locally (no fork)
    const allDocs = await LocalDocumentService.getGuestDocuments(USER);
    expect(allDocs).toHaveLength(1);
  });

  it('Condition 1 & Test 3: User with one device NEVER sees a fork across offline sessions', async () => {
    const conflictSpy = vi.spyOn(ConflictResolver, 'resolveConflict');

    // 1. Initial write of v1 on single device
    mockCloudDocs.set(CLOUD_ID, {
      id: CLOUD_ID,
      uuid: CLOUD_ID,
      currentVersion: 1,
      totalWords: 5,
      totalDuration: 20,
      title: 'Diary',
    });
    mockCloudVersions.set(CLOUD_ID, [
      { id: 'cver_1', documentId: CLOUD_ID, version: 1, content: 'Day 1 text', wordCount: 5, duration: 20, wpm: 15 },
    ]);

    const db = await getLocalDb();
    const docId = 'local_single_user';
    await db.put('documents', {
      id: docId,
      guestId: USER,
      title: 'Diary',
      currentVersion: 1,
      linkedCloudId: CLOUD_ID,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      totalWords: 5,
      totalDuration: 20,
      sessionsCount: 1,
      tags: [],
    } as any);

    await db.put('versions', {
      id: 'ver_1',
      documentId: docId,
      guestId: USER,
      version: 1,
      content: 'Day 1 text',
      wordCount: 5,
      duration: 20,
      wpm: 15,
      sessionStartedAt: 1000,
      savedAt: 1000,
    } as any);

    // 2. User writes Session 2 (online): v2
    const res2 = await CloudSyncService.syncVersionToCloud(
      USER,
      docId,
      CLOUD_ID,
      {
        title: 'Diary',
        content: 'Day 1 text + Day 2 text',
        wordCount: 10,
        duration: 25,
        wpm: 20,
        sessionStartedAt: new Date(2000),
      } as any,
      2,
      'Day 1 text'
    );
    expect(res2.forked).toBe(false);

    // 3. User goes offline: writes Session 3 locally
    await db.put('versions', {
      id: 'ver_3',
      documentId: docId,
      guestId: USER,
      version: 3,
      content: 'Day 1 + Day 2 + Day 3 text',
      wordCount: 15,
      duration: 30,
      wpm: 25,
      sessionStartedAt: 3000,
      savedAt: 3000,
    } as any);

    // 4. User comes back online and syncs Session 3
    const res3 = await CloudSyncService.syncVersionToCloud(
      USER,
      docId,
      CLOUD_ID,
      {
        title: 'Diary',
        content: 'Day 1 + Day 2 + Day 3 text',
        wordCount: 15,
        duration: 30,
        wpm: 25,
        sessionStartedAt: new Date(3000),
      } as any,
      3,
      'Day 1 text + Day 2 text'
    );
    expect(res3.forked).toBe(false);

    // 5. Zero conflict calls throughout the entire lifecycle
    expect(conflictSpy).not.toHaveBeenCalled();
    const allDocs = await LocalDocumentService.getGuestDocuments(USER);
    expect(allDocs).toHaveLength(1);
    expect(mockCloudDocs.get(CLOUD_ID)!.currentVersion).toBe(3);
  });

  it('Test 4: Idempotent replay on single device never forks', async () => {
    const conflictSpy = vi.spyOn(ConflictResolver, 'resolveConflict');

    // Cloud already has v2 ("Text at v2")
    mockCloudDocs.set(CLOUD_ID, {
      id: CLOUD_ID,
      uuid: CLOUD_ID,
      currentVersion: 2,
      totalWords: 5,
      totalDuration: 20,
      title: 'Replay Note',
    });
    mockCloudVersions.set(CLOUD_ID, [
      { id: 'cver_1', documentId: CLOUD_ID, version: 1, content: 'Text at v1', wordCount: 3, duration: 10, wpm: 18 },
      { id: 'cver_2', documentId: CLOUD_ID, version: 2, content: 'Text at v2', wordCount: 5, duration: 20, wpm: 20 },
    ]);

    const db = await getLocalDb();
    const docId = 'local_doc_replay';
    await db.put('documents', {
      id: docId,
      guestId: USER,
      title: 'Replay Note',
      currentVersion: 1,
      linkedCloudId: CLOUD_ID,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      totalWords: 3,
      totalDuration: 10,
      sessionsCount: 1,
      tags: [],
    } as any);

    // Client retries v2 with the exact content already in cloud
    const res = await CloudSyncService.syncVersionToCloud(
      USER,
      docId,
      CLOUD_ID,
      {
        title: 'Replay Note',
        content: 'Text at v2',
        wordCount: 5,
        duration: 20,
        wpm: 20,
        sessionStartedAt: new Date(2000),
      } as any,
      2,
      'Text at v1'
    );

    expect(conflictSpy).not.toHaveBeenCalled();
    expect(res.forked).toBe(false);
    expect(mockCloudDocs.get(CLOUD_ID)!.currentVersion).toBe(2);
    const allDocs = await LocalDocumentService.getGuestDocuments(USER);
    expect(allDocs).toHaveLength(1);
  });
});
