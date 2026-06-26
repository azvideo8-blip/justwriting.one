import { getLocalDb, LocalDocument, randomUUID } from '../storage/localDb';

export const LocalDocumentService = {
  async createDocument(
    guestId: string,
    data: { title: string; tags?: string[] | undefined; labelId?: string | undefined; firstSessionAt?: number | undefined; lastSessionAt?: number | undefined }
  ): Promise<string> {
    const db = await getLocalDb();
    const id = `local_${randomUUID()}`;
    const now = Date.now();

    await db.put('documents', {
      id,
      guestId,
      title: data.title || '',
      currentVersion: 0,
      totalWords: 0,
      totalDuration: 0,
      sessionsCount: 0,
      firstSessionAt: data.firstSessionAt ?? now,
      lastSessionAt: data.lastSessionAt ?? now,
      tags: data.tags ?? [],
      labelId: data.labelId ?? undefined,
    });

    return id;
  },

  async getDocument(id: string): Promise<LocalDocument | undefined> {
    const db = await getLocalDb();
    return db.get('documents', id) ?? undefined;
  },

  async getGuestDocuments(guestId: string): Promise<LocalDocument[]> {
    const db = await getLocalDb();
    const all = await db.getAllFromIndex('documents', 'by-guest', guestId);
    return all.sort((a, b) => b.lastSessionAt - a.lastSessionAt);
  },

  async updateAfterSession(
    id: string,
    data: { totalWords: number; totalDuration: number; currentVersion: number; mood?: string | undefined }
  ): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction(['documents', 'profile'], 'readwrite');
    const existing = await tx.objectStore('documents').get(id);
    if (!existing) { await tx.done; return; }
    const now = Date.now();

    await tx.objectStore('documents').put({
      ...existing,
      totalWords: data.totalWords,
      totalDuration: data.totalDuration,
      currentVersion: data.currentVersion,
      sessionsCount: data.currentVersion,
      lastSessionAt: now,
      mood: data.mood,
    });

    const profile = await tx.objectStore('profile').get(existing.guestId);
    if (profile) {
      await tx.objectStore('profile').put({
        ...profile,
        totalWords: profile.totalWords - existing.totalWords + data.totalWords,
        totalDuration: profile.totalDuration - existing.totalDuration + data.totalDuration,
        sessionsCount: profile.sessionsCount - (existing.sessionsCount || 0) + data.currentVersion,
        lastSessionAt: now,
      });
      await tx.done;
    } else {
      await tx.done;
      await LocalDocumentService._updateProfile(existing.guestId);
    }
  },

  async updateDocument(
    id: string,
    data: { totalWords?: number; totalDuration?: number; currentVersion?: number; sessionsCount?: number }
  ): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({
      ...existing,
      ...(data.totalWords !== undefined && { totalWords: data.totalWords }),
      ...(data.totalDuration !== undefined && { totalDuration: data.totalDuration }),
      ...(data.currentVersion !== undefined && { currentVersion: data.currentVersion }),
      ...(data.sessionsCount !== undefined && { sessionsCount: data.sessionsCount }),
    });
    await tx.done;
  },

  async deleteDocument(id: string): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction(['documents', 'versions'], 'readwrite');
    const verStore = tx.objectStore('versions');
    const docStore = tx.objectStore('documents');
    const versions = await verStore.index('by-document').getAll(id);
    const doc = await docStore.get(id);
    await Promise.all([
      ...versions.map(v => verStore.delete(v.id)),
      docStore.delete(id),
      tx.done,
    ]);
    if (doc) await LocalDocumentService._updateProfile(doc.guestId);
  },

  async updateTags(id: string, tags: string[]): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({ ...existing, tags });
    await tx.done;
  },

  async updateTitle(id: string, title: string): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({ ...existing, title });
    await tx.done;
  },

  async updateDate(id: string, firstSessionAt: number, lastSessionAt: number): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction(['documents', 'versions'], 'readwrite');
    const existing = await tx.objectStore('documents').get(id);
    if (!existing) { await tx.done; return; }
    await tx.objectStore('documents').put({ ...existing, firstSessionAt, lastSessionAt });
    const versions = await tx.objectStore('versions').index('by-document').getAll(id);
    if (versions.length > 0) {
      versions.sort((a, b) => a.version - b.version);
      const first = versions[0];
      if (first) {
        first.sessionStartedAt = firstSessionAt;
        await tx.objectStore('versions').put(first);
      }
    }
    await tx.done;
  },

  async updateLinkedCloudId(id: string, cloudId: string): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({ ...existing, linkedCloudId: cloudId });
    await tx.done;
  },

  async updateLabelId(id: string, labelId: string | undefined): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({ ...existing, labelId: labelId ?? undefined });
    await tx.done;
  },

  async migrateDocumentOwner(documentId: string, newOwnerId: string): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction(['documents', 'versions'], 'readwrite');
    const docStore = tx.objectStore('documents');
    const verStore = tx.objectStore('versions');

    const doc = await docStore.get(documentId);
    if (!doc) {
      await tx.done;
      return;
    }

    if (doc.guestId === newOwnerId) {
      await tx.done;
      return;
    }

    const oldOwnerId = doc.guestId;
    const versions = await verStore.index('by-document').getAll(documentId);

    await Promise.all([
      docStore.put({ ...doc, guestId: newOwnerId }),
      ...versions.map(ver => verStore.put({ ...ver, guestId: newOwnerId })),
      tx.done,
    ]);

    await LocalDocumentService._updateProfile(oldOwnerId);
    await LocalDocumentService._updateProfile(newOwnerId);
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

  async clearLabelFromAllDocs(userId: string, labelId: string): Promise<void> {
    const db = await getLocalDb();
    const all = await db.getAllFromIndex('documents', 'by-guest', userId);
    const matching = all.filter(d => d.labelId === labelId);
    if (matching.length === 0) return;
    const tx = db.transaction('documents', 'readwrite');
    await Promise.all(matching.map(d => tx.store.put({ ...d, labelId: undefined })));
    await tx.done;
  },

  async renameTagInAllDocs(userId: string, oldTag: string, newTag: string): Promise<void> {
    const db = await getLocalDb();
    const all = await db.getAllFromIndex('documents', 'by-guest', userId);
    const matching = all.filter(d => Array.isArray(d.tags) && d.tags.includes(oldTag));
    if (matching.length === 0) return;
    const tx = db.transaction('documents', 'readwrite');
    await Promise.all(matching.map(d => tx.store.put({ ...d, tags: (d.tags ?? []).map(t => t === oldTag ? newTag : t) })));
    await tx.done;
  },

  async removeTagFromAllDocs(userId: string, tag: string): Promise<void> {
    const db = await getLocalDb();
    const all = await db.getAllFromIndex('documents', 'by-guest', userId);
    const matching = all.filter(d => Array.isArray(d.tags) && d.tags.includes(tag));
    if (matching.length === 0) return;
    const tx = db.transaction('documents', 'readwrite');
    await Promise.all(matching.map(d => tx.store.put({ ...d, tags: (d.tags ?? []).filter(t => t !== tag) })));
    await tx.done;
  },

  async getProfile(guestId: string) {
    const db = await getLocalDb();
    return db.get('profile', guestId);
  },
};
