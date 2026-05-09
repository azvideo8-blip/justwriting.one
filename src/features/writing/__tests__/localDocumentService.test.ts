// Must be first — patches globalThis.indexedDB before any idb import
import 'fake-indexeddb/auto';

import { describe, it, expect, beforeEach } from 'vitest';
import { getLocalDb, resetDbInstance } from '../../../shared/lib/localDb';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { LocalVersionService } from '../services/LocalVersionService';

// Reset IDB state between tests
beforeEach(async () => {
  resetDbInstance();
  // Delete the database and re-open fresh each time
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('justwriting-local');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

const GUEST = 'guest_test_001';

// ─── createDocument + getDocument ────────────────────────────────────────────

describe('createDocument + getDocument', () => {
  it('createDocument returns an ID starting with "local_"', async () => {
    const id = await LocalDocumentService.createDocument(GUEST, { title: 'Hello' });
    expect(id).toMatch(/^local_/);
  });

  it('getDocument returns the created document with correct fields', async () => {
    const id = await LocalDocumentService.createDocument(GUEST, { title: 'My Doc', tags: ['fiction'] });
    const doc = await LocalDocumentService.getDocument(id);
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe('My Doc');
    expect(doc!.guestId).toBe(GUEST);
    expect(doc!.tags).toEqual(['fiction']);
    expect(doc!.sessionsCount).toBe(0);
    expect(doc!.totalWords).toBe(0);
  });

  it('getDocument returns null/undefined for unknown id', async () => {
    const doc = await LocalDocumentService.getDocument('local_doesnotexist');
    // IDB returns undefined for missing keys; the service passes it through via ?? null
    expect(doc == null).toBe(true);
  });
});

// ─── getGuestDocuments ────────────────────────────────────────────────────────

describe('getGuestDocuments', () => {
  it('returns only docs for that guestId', async () => {
    await LocalDocumentService.createDocument(GUEST, { title: 'Doc A' });
    await LocalDocumentService.createDocument(GUEST, { title: 'Doc B' });
    await LocalDocumentService.createDocument('guest_other', { title: 'Other' });

    const docs = await LocalDocumentService.getGuestDocuments(GUEST);
    expect(docs).toHaveLength(2);
    docs.forEach(d => expect(d.guestId).toBe(GUEST));
  });

  it('sorts by lastSessionAt descending', async () => {
    // Use Date.now spy to control timestamps without affecting setTimeout
    let fakeNow = 1_000_000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    const id1 = await LocalDocumentService.createDocument(GUEST, { title: 'First' });
    fakeNow = 1_001_000; // 1s later
    const id2 = await LocalDocumentService.createDocument(GUEST, { title: 'Second' });

    // Update id1 at a later time — making it the most recently active
    fakeNow = 5_000_000; // much later
    await LocalDocumentService.updateAfterSession(id1, {
      totalWords: 10,
      totalDuration: 60,
      currentVersion: 1,
    });

    spy.mockRestore();

    const docs = await LocalDocumentService.getGuestDocuments(GUEST);
    // id1 was updated more recently, should come first
    expect(docs[0].id).toBe(id1);
    expect(docs[1].id).toBe(id2);
  });
});

// ─── updateAfterSession ───────────────────────────────────────────────────────

describe('updateAfterSession', () => {
  it('increments sessionsCount', async () => {
    const id = await LocalDocumentService.createDocument(GUEST, { title: 'Test' });
    await LocalDocumentService.updateAfterSession(id, { totalWords: 100, totalDuration: 300, currentVersion: 1 });
    const doc = await LocalDocumentService.getDocument(id);
    expect(doc!.sessionsCount).toBe(1);

    await LocalDocumentService.updateAfterSession(id, { totalWords: 200, totalDuration: 600, currentVersion: 2 });
    const doc2 = await LocalDocumentService.getDocument(id);
    expect(doc2!.sessionsCount).toBe(2);
  });

  it('updates totalWords and totalDuration', async () => {
    const id = await LocalDocumentService.createDocument(GUEST, { title: 'Test' });
    await LocalDocumentService.updateAfterSession(id, { totalWords: 500, totalDuration: 1800, currentVersion: 1 });
    const doc = await LocalDocumentService.getDocument(id);
    expect(doc!.totalWords).toBe(500);
    expect(doc!.totalDuration).toBe(1800);
  });

  it('updates lastSessionAt to a recent timestamp', async () => {
    const before = Date.now();
    const id = await LocalDocumentService.createDocument(GUEST, { title: 'Test' });
    await LocalDocumentService.updateAfterSession(id, { totalWords: 10, totalDuration: 60, currentVersion: 1 });
    const doc = await LocalDocumentService.getDocument(id);
    expect(doc!.lastSessionAt).toBeGreaterThanOrEqual(before);
    expect(doc!.lastSessionAt).toBeLessThanOrEqual(Date.now());
  });
});

// ─── deleteDocument ───────────────────────────────────────────────────────────

describe('deleteDocument', () => {
  it('removes the document', async () => {
    const id = await LocalDocumentService.createDocument(GUEST, { title: 'To delete' });
    await LocalDocumentService.deleteDocument(id);
    const doc = await LocalDocumentService.getDocument(id);
    // After deletion, IDB returns undefined (the service passes ?? null but fake-indexeddb returns undefined)
    expect(doc == null).toBe(true);
  });

  it('also removes all associated versions (cascade)', async () => {
    const id = await LocalDocumentService.createDocument(GUEST, { title: 'With versions' });
    // Add a version
    await LocalVersionService.addVersion(GUEST, id, {
      content: 'Hello',
      previousContent: '',
      wordCount: 1,
      duration: 60,
      wpm: 60,
      versionNumber: 1,
      sessionStartedAt: new Date(),
    });
    // Verify version exists
    const versionsBefore = await LocalVersionService.getVersions(id);
    expect(versionsBefore).toHaveLength(1);

    await LocalDocumentService.deleteDocument(id);

    // Versions should be gone
    const versionsAfter = await LocalVersionService.getVersions(id);
    expect(versionsAfter).toHaveLength(0);
  });
});

// ─── updateLinkedCloudId ──────────────────────────────────────────────────────

describe('updateLinkedCloudId', () => {
  it('sets the linkedCloudId field', async () => {
    const id = await LocalDocumentService.createDocument(GUEST, { title: 'Doc' });
    await LocalDocumentService.updateLinkedCloudId(id, 'cloud_abc123');
    const doc = await LocalDocumentService.getDocument(id);
    expect(doc!.linkedCloudId).toBe('cloud_abc123');
  });
});

// ─── updateTags ───────────────────────────────────────────────────────────────

describe('updateTags', () => {
  it('updates tags correctly', async () => {
    const id = await LocalDocumentService.createDocument(GUEST, { title: 'Doc', tags: ['old'] });
    await LocalDocumentService.updateTags(id, ['new', 'tags']);
    const doc = await LocalDocumentService.getDocument(id);
    expect(doc!.tags).toEqual(['new', 'tags']);
  });
});

// ─── _updateProfile ───────────────────────────────────────────────────────────

describe('_updateProfile', () => {
  it('aggregates stats correctly across multiple docs', async () => {
    const id1 = await LocalDocumentService.createDocument(GUEST, { title: 'Doc 1' });
    const id2 = await LocalDocumentService.createDocument(GUEST, { title: 'Doc 2' });

    await LocalDocumentService.updateAfterSession(id1, { totalWords: 100, totalDuration: 300, currentVersion: 1 });
    await LocalDocumentService.updateAfterSession(id2, { totalWords: 200, totalDuration: 600, currentVersion: 1 });

    const profile = await LocalDocumentService.getProfile(GUEST);
    expect(profile).not.toBeUndefined();
    expect(profile!.totalWords).toBe(300);       // 100 + 200
    expect(profile!.totalDuration).toBe(900);    // 300 + 600
    expect(profile!.sessionsCount).toBe(2);      // 1 session each
  });
});
