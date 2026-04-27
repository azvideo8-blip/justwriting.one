import { getLocalDb, LocalDocument } from '../../../shared/lib/localDb';
import { computeWordDiff } from './DiffService';

export const LocalDocumentService = {
  async createDocument(
    guestId: string,
    data: { title: string; tags?: string[] }
  ): Promise<string> {
    const db = await getLocalDb();
    const id = `local_${crypto.randomUUID()}`;
    const now = Date.now();

    await db.put('documents', {
      id,
      guestId,
      title: data.title || '',
      currentVersion: 0,
      totalWords: 0,
      totalDuration: 0,
      sessionsCount: 0,
      firstSessionAt: now,
      lastSessionAt: now,
      isPublic: false,
      tags: data.tags ?? [],
    });

    return id;
  },

  async getDocument(id: string): Promise<LocalDocument | null> {
    const db = await getLocalDb();
    return db.get('documents', id) ?? null;
  },

  async getGuestDocuments(guestId: string): Promise<LocalDocument[]> {
    const db = await getLocalDb();
    const all = await db.getAllFromIndex('documents', 'by-guest', guestId);
    return all.sort((a, b) => b.lastSessionAt - a.lastSessionAt);
  },

  async updateAfterSession(
    id: string,
    data: { totalWords: number; totalDuration: number; currentVersion: number }
  ): Promise<void> {
    const db = await getLocalDb();
    const existing = await db.get('documents', id);
    if (!existing) return;

    await db.put('documents', {
      ...existing,
      totalWords: data.totalWords,
      totalDuration: data.totalDuration,
      currentVersion: data.currentVersion,
      sessionsCount: data.currentVersion,
      lastSessionAt: Date.now(),
    });

    await LocalDocumentService._updateProfile(existing.guestId);
  },

  async deleteDocument(id: string): Promise<void> {
    const db = await getLocalDb();
    const versions = await db.getAllFromIndex('versions', 'by-document', id);
    const doc = await db.get('documents', id);
    const tx = db.transaction(['documents', 'versions'], 'readwrite');
    await Promise.all([
      ...versions.map(v => tx.objectStore('versions').delete(v.id)),
      tx.objectStore('documents').delete(id),
      tx.done,
    ]);
    if (doc) await LocalDocumentService._updateProfile(doc.guestId);
  },

  async _updateProfile(guestId: string): Promise<void> {
    const db = await getLocalDb();
    const docs = await LocalDocumentService.getGuestDocuments(guestId);

    await db.put('profile', {
      guestId,
      totalWords: docs.reduce((s, d) => s + d.totalWords, 0),
      sessionsCount: docs.reduce((s, d) => s + d.sessionsCount, 0),
      totalDuration: docs.reduce((s, d) => s + d.totalDuration, 0),
      lastSessionAt: docs[0]?.lastSessionAt ?? Date.now(),
    });
  },

  async getProfile(guestId: string) {
    const db = await getLocalDb();
    return db.get('profile', guestId);
  },
};
