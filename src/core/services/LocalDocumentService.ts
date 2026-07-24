import { getLocalDb, LocalDocument, randomUUID } from '../storage/localDb';
import { reportError } from '../../shared/errors/reportError';


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
      sessionsCount: (existing.sessionsCount || 0) + 1,
      lastSessionAt: now,
      mood: data.mood,
    });

    const profile = await tx.objectStore('profile').get(existing.guestId);
    if (profile) {
      await tx.objectStore('profile').put({
        ...profile,
        totalWords: profile.totalWords - existing.totalWords + data.totalWords,
        totalDuration: profile.totalDuration - existing.totalDuration + data.totalDuration,
        sessionsCount: profile.sessionsCount - (existing.sessionsCount || 0) + 1,
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

    // SEC-41: Cascade delete AI derivatives for deleted document
    await LocalDocumentService.cascadeDeleteAIDerivatives(id);
  },

  async cascadeDeleteAIDerivatives(documentId: string): Promise<void> {
    try {
      const db = await getLocalDb();

      // 1. Delete aiSummaries, aiEmbeddings, aiTimeline
      await Promise.all([
        db.delete('aiSummaries', documentId).catch(() => {}),
        db.delete('aiEmbeddings', documentId).catch(() => {}),
        db.delete('aiTimeline', documentId).catch(() => {}),
      ]);

      // 2. Delete aiDialogues & related aiChatMemory
      try {
        const dialogues = await db.getAllFromIndex('aiDialogues', 'by-document', documentId);
        for (const d of dialogues) {
          try {
            const memories = await db.getAllFromIndex('aiChatMemory', 'by-dialogue', d.id);
            for (const m of memories) {
              await db.delete('aiChatMemory', m.id).catch(() => {});
            }
          } catch { /* ignore */ }
          await db.delete('aiDialogues', d.id).catch(() => {});
        }
      } catch { /* ignore */ }

      // 3. Delete aiCommitments
      try {
        const commitments = await db.getAll('aiCommitments');
        for (const c of commitments) {
          if (c.documentId === documentId) {
            await db.delete('aiCommitments', c.id).catch(() => {});
          }
        }
      } catch { /* ignore */ }

      // 4. Delete aiThreads
      try {
        const threads = await db.getAll('aiThreads');
        for (const t of threads) {
          if ((t as { documentId?: string }).documentId === documentId) {
            await db.delete('aiThreads', t.id).catch(() => {});
          }
        }
      } catch { /* ignore */ }

      // 5. Clean lifeStory entries
      try {
        const lifeEntries = await db.getAll('lifeStory');
        for (const entry of lifeEntries) {
          if (entry.sourceDocumentIds?.includes(documentId)) {
            const updatedSources = entry.sourceDocumentIds.filter(sid => sid !== documentId);
            if (updatedSources.length === 0) {
              await db.delete('lifeStory', entry.eventDate).catch(() => {});
            } else {
              await db.put('lifeStory', { ...entry, sourceDocumentIds: updatedSources }).catch(() => {});
            }
          }
        }
      } catch { /* ignore */ }


      // 6. Clean aiThemeLedger evidence & records
      try {
        const themeRecords = await db.getAll('aiThemeLedger');
        for (const record of themeRecords) {
          const hasEvidence = record.evidence.some(e => e.noteId === documentId);
          if (hasEvidence) {
            const filteredEv = record.evidence.filter(e => e.noteId !== documentId);
            const newCount = Math.max(0, record.count - 1);
            if (filteredEv.length === 0 || newCount === 0) {
              await db.delete('aiThemeLedger', record.id).catch(() => {});
            } else {
              await db.put('aiThemeLedger', { ...record, evidence: filteredEv, count: newCount }).catch(() => {});
            }
          }
        }
      } catch { /* ignore */ }
    } catch (e) {
      reportError(e, { action: 'cascadeDeleteAIDerivatives', documentId });
    }
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

  // Reconcile sessionsCount for all documents of a user/guest by recounting
  // actual version rows. Fixes drift from the incremental update approach.
  async reconcileSessionsCount(guestId: string): Promise<{ docsFixed: number; profileFixed: boolean }> {
    const db = await getLocalDb();
    const docs = await db.getAllFromIndex('documents', 'by-guest', guestId);
    let docsFixed = 0;

    const tx = db.transaction(['documents', 'versions', 'profile'], 'readwrite');
    for (const doc of docs) {
      const versions = await tx.objectStore('versions').index('by-document').getAll(doc.id);
      const actualCount = versions.length;
      if (doc.sessionsCount !== actualCount) {
        await tx.objectStore('documents').put({ ...doc, sessionsCount: actualCount });
        docsFixed++;
      }
    }

    // Recalculate profile sessionsCount from all docs
    const profile = await tx.objectStore('profile').get(guestId);
    let profileFixed = false;
    if (profile) {
      const allDocs = await tx.objectStore('documents').getAll();
      const userDocs = allDocs.filter(d => d.guestId === guestId);
      const totalSessions = userDocs.reduce((sum, d) => sum + (d.sessionsCount || 0), 0);
      if (profile.sessionsCount !== totalSessions) {
        await tx.objectStore('profile').put({ ...profile, sessionsCount: totalSessions });
        profileFixed = true;
      }
    }
    await tx.done;

    return { docsFixed, profileFixed };
  },
};
