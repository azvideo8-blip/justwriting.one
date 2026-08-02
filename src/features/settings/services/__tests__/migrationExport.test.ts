import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance, type LocalDocument, type LocalVersion } from '../../../../core/storage/localDb';
import { exportMigrationManifest } from '../migrationExport';

async function clear() {
  const db = await getLocalDb();
  const names = Array.from(db.objectStoreNames);
  for (const name of names) {
    for (const rec of await db.getAll(name)) {
      const key = (rec as { id: string }).id ?? (rec as { userId: string }).userId ?? (rec as { documentId: string }).documentId;
      if (key != null) await db.delete(name, key);
    }
  }
}

const DOC_BASE: Omit<LocalDocument, 'id' | 'uuid' | 'guestId'> = {
  title: 'Test Note',
  currentVersion: 2,
  totalWords: 10,
  totalDuration: 60,
  sessionsCount: 2,
  firstSessionAt: 1000,
  lastSessionAt: 2000,
  tags: ['test'],
};

function makeDoc(id: string, uuid: string): LocalDocument {
  return { id, uuid, guestId: 'u1', ...DOC_BASE };
}

function makeVersion(id: string, documentId: string, version: number, content: string): LocalVersion {
  return {
    id,
    documentId,
    guestId: 'u1',
    version,
    content,
    wordCount: content.split(/\s+/).length,
    wordsAdded: 1,
    charsAdded: content.length,
    duration: 30,
    wpm: 60,
    savedAt: 1000 + version * 1000,
    sessionStartedAt: 1000 + version * 1000,
  };
}

describe('migrationExport', () => {
  beforeEach(async () => {
    resetDbInstance();
    localStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('justwriting-local');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });

  it('exports all versions, not just the latest', async () => {
    const db = await getLocalDb();
    await db.put('documents', makeDoc('d1', 'uuid-1'));
    await db.put('versions', makeVersion('v1', 'd1', 1, 'first version'));
    await db.put('versions', makeVersion('v2', 'd1', 2, 'second version'));

    const manifest = await exportMigrationManifest();
    expect(manifest.counters.versions).toBe(2);
    expect(manifest.documents[0]!.versions).toHaveLength(2);
    expect(manifest.documents[0]!.versions[0]!.content).toBe('first version');
    expect(manifest.documents[0]!.versions[1]!.content).toBe('second version');
  });

  it('preserves ciphertext byte-for-byte (content passes through as-is)', async () => {
    const db = await getLocalDb();
    const ciphertext = '🔒base64==encrypted内容特殊文字';
    await db.put('documents', makeDoc('d1', 'uuid-1'));
    await db.put('versions', makeVersion('v1', 'd1', 1, ciphertext));

    const manifest = await exportMigrationManifest();
    expect(manifest.documents[0]!.versions[0]!.content).toBe(ciphertext);
  });

  it('computes sha-256 checksums for each version', async () => {
    const db = await getLocalDb();
    await db.put('documents', makeDoc('d1', 'uuid-1'));
    await db.put('versions', makeVersion('v1', 'd1', 1, 'hello'));

    const manifest = await exportMigrationManifest();
    expect(Object.keys(manifest.checksums)).toHaveLength(1);
    expect(manifest.checksums['v1']).toMatch(/^[0-9a-f]{64}$/);
    // sha-256 of "hello"
    expect(manifest.checksums['v1']).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('counters match actual data', async () => {
    const db = await getLocalDb();
    await db.put('documents', makeDoc('d1', 'uuid-1'));
    await db.put('documents', makeDoc('d2', 'uuid-2'));
    await db.put('versions', makeVersion('v1', 'd1', 1, 'a'));
    await db.put('versions', makeVersion('v2', 'd1', 2, 'b'));
    await db.put('versions', makeVersion('v3', 'd2', 1, 'c'));

    const manifest = await exportMigrationManifest();
    expect(manifest.counters.documents).toBe(2);
    expect(manifest.counters.versions).toBe(3);
  });

  it('unreadable record appears in skipped, not silently lost', async () => {
    const db = await getLocalDb();
    await db.put('documents', makeDoc('d1', 'uuid-1'));
    await db.put('versions', makeVersion('v1', 'd1', 1, 'ok'));

    // Simulate a broken document by deleting the uuid (pre-C1 doc scenario)
    await db.put('documents', {
      id: 'd_old',
      guestId: 'u1',
      title: 'old',
      currentVersion: 0,
      totalWords: 0,
      totalDuration: 0,
      sessionsCount: 0,
      firstSessionAt: 0,
      lastSessionAt: 0,
      tags: [],
      // no uuid
    } as never);

    const manifest = await exportMigrationManifest();
    const skippedDoc = manifest.skipped.find(s => s.id === 'd_old');
    expect(skippedDoc).toBeDefined();
    expect(skippedDoc!.reason).toContain('missing uuid');
    // The skipped doc's versions are NOT counted
    expect(manifest.counters.documents).toBe(1);
  });

  // ── Non-vacuity check: store-level read failure goes to skipped ──────
  it('failed store read produces skipped entry and does not lose the counter', async () => {
    const db = await getLocalDb();
    await db.put('documents', makeDoc('d1', 'uuid-1'));
    await db.put('versions', makeVersion('v1', 'd1', 1, 'ok'));

    // Monkey-patch getAll to throw for 'documents'
    const originalGetAll = db.getAll.bind(db);
    let callCount = 0;
    (db as unknown as { getAll: (name: string) => unknown[] }).getAll = (name: string) => {
      if (name === 'documents') {
        callCount++;
        throw new Error('IndexedDB read failure');
      }
      return originalGetAll(name as never);
    };

    const manifest = await exportMigrationManifest();
    expect(callCount).toBeGreaterThan(0);
    expect(manifest.skipped.some(s => s.store === 'documents' && s.reason.includes('IndexedDB read failure'))).toBe(true);
    // Counter for documents should be 0 (nothing exported), not missing
    expect(manifest.counters.documents).toBe(0);
  });

  it('skips documents without uuid', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'no_uuid',
      guestId: 'u1',
      title: 'no uuid doc',
      currentVersion: 0,
      totalWords: 0,
      totalDuration: 0,
      sessionsCount: 0,
      firstSessionAt: 0,
      lastSessionAt: 0,
      tags: [],
    } as never);

    const manifest = await exportMigrationManifest();
    expect(manifest.skipped.some(s => s.id === 'no_uuid' && s.reason.includes('missing uuid'))).toBe(true);
    expect(manifest.counters.documents).toBe(0);
  });
});
