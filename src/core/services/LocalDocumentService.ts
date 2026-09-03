import { getLocalDb, LocalDocument, randomUUID } from '../storage/localDb';
import { reportError } from '../../shared/errors/reportError';
import { withFacetLock } from './facetLock';
import { LocalStoreSyncService } from './LocalStoreSyncService';
import { DataProvider } from '../data';
import { getCurrentUser } from '../auth';

/**
 * Сносит облачную копию производной ИИ, привязанной к заметке.
 *
 * Сводки и векторы лежат не в `local_store_records`, а в своих таблицах, и
 * очередь `scheduleStoreDelete` до них не достаёт. Ключ строки — ПОСТОЯННЫЙ
 * номер заметки: политика доступа в базе сверяет его с `documents.uuid`, и по
 * локальному `local_…` не удалится ничего.
 */
async function deleteCloudDerivative(kind: 'summary' | 'embedding', canonicalId: string): Promise<void> {
  const uid = getCurrentUser()?.uid;
  if (!uid || uid.startsWith('guest_')) return;
  try {
    if (kind === 'summary') await DataProvider.deleteSummary(uid, canonicalId);
    else await DataProvider.deleteEmbedding(uid, canonicalId);
  } catch (e) {
    reportError(e, { action: `cascadeDelete_cloud_${kind}`, canonicalId });
  }
}


export const LocalDocumentService = {
  async createDocument(
    guestId: string,
    data: { title: string; tags?: string[] | undefined; labelId?: string | undefined; uuid?: string | undefined; firstSessionAt?: number | undefined; lastSessionAt?: number | undefined; mood?: string | undefined; excludedFromAI?: boolean | undefined; _locked?: boolean | undefined; _decryptionError?: boolean | undefined }
  ): Promise<string> {
    if (data._locked || data._decryptionError) {
      throw new Error('LOCKED: cannot save locked document to local storage');
    }
    const db = await getLocalDb();
    const id = `local_${randomUUID()}`;
    const now = Date.now();

    await db.put('documents', {
      id,
      uuid: randomUUID(),
      guestId,
      title: data.title || '',
      currentVersion: 0,
      totalWords: 0,
      totalDuration: 0,
      sessionsCount: 0,
      firstSessionAt: data.firstSessionAt ?? now,
      lastSessionAt: data.lastSessionAt ?? now,
      tags: data.tags ?? [],
      // Исключение из ИИ — решение человека о приватности, а не украшение
      // карточки. Не переехав на второе устройство, оно там молча
      // отменяется, и заметку начинает читать индексатор.
      ...(data.excludedFromAI !== undefined ? { excludedFromAI: data.excludedFromAI } : {}),
      ...(data.mood !== undefined ? { mood: data.mood } : {}),
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
        sessionsCount: profile.sessionsCount + 1,
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
    data: { totalWords?: number; totalDuration?: number; currentVersion?: number; sessionsCount?: number; lastSyncedCloudVersion?: number }
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
      ...(data.lastSyncedCloudVersion !== undefined && { lastSyncedCloudVersion: data.lastSyncedCloudVersion }),
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

    // SEC-41: Cascade delete AI derivatives for deleted document.
    //
    // Постоянный номер передаётся ОТСЮДА, потому что заметки уже нет: строкой
    // выше её удалили. Уборка производных не может достать uuid сама — она
    // прочитает undefined и пойдёт удалять облачные строки по локальному
    // номеру, которого в облаке нет. Ровно эта ошибка тут и была.
    await LocalDocumentService.cascadeDeleteAIDerivatives(id, doc?.uuid);
  },

  /**
   * @param canonicalUuid Постоянный номер заметки, снятый ДО её удаления.
   *   Обязателен, когда заметки в хранилище уже нет: облачные строки сводки и
   *   вектора ключуются им, и по локальному номеру не удалится ничего.
   */
  async cascadeDeleteAIDerivatives(documentId: string, canonicalUuid?: string): Promise<void> {
    try {
      const db = await getLocalDb();

      const doc = canonicalUuid ? undefined : await db.get('documents', documentId).catch(() => undefined);
      const canonicalId = canonicalUuid ?? doc?.uuid;

      // 1. Delete aiSummaries, aiEmbeddings, aiTimeline
      await Promise.all([
        db.delete('aiSummaries', documentId).catch(() => {}),
        db.delete('aiEmbeddings', documentId).catch(() => {}),
        db.delete('aiTimeline', documentId).catch(() => {}),
      ]);
      // Облачные копии тех же трёх. Локального удаления мало: восстановление
      // из облака вернуло бы разбор удалённой заметки обратно на устройство.
      LocalStoreSyncService.scheduleStoreDelete('aiTimeline', documentId);
      if (canonicalId) {
        void deleteCloudDerivative('summary', canonicalId);
        void deleteCloudDerivative('embedding', canonicalId);
      } else {
        // Постоянного номера нет ни здесь, ни у вызывающего: удалять в облаке
        // нечем. Молчать нельзя — иначе разбор удалённой заметки останется там
        // навсегда, и узнать об этом будет неоткуда.
        reportError(
          new Error('cascadeDelete: canonical uuid unavailable, cloud derivatives left behind'),
          { action: 'cascadeDeleteAIDerivatives_noUuid', documentId },
          'warning',
        );
      }

      // 2. Delete aiDialogues & related aiChatMemory
      try {
        const dialogues = await db.getAllFromIndex('aiDialogues', 'by-document', documentId);
        for (const d of dialogues) {
          try {
            const memories = await db.getAllFromIndex('aiChatMemory', 'by-dialogue', d.id);
            for (const m of memories) {
              await db.delete('aiChatMemory', m.id).catch(() => {});
              LocalStoreSyncService.scheduleStoreDelete('aiChatMemory', m.id);
            }
          } catch { /* ignore */ }
          await db.delete('aiDialogues', d.id).catch(() => {});
          LocalStoreSyncService.scheduleStoreDelete('aiDialogues', d.id);
        }
      } catch { /* ignore */ }

      // 3. Delete aiCommitments
      try {
        const commitments = await db.getAll('aiCommitments');
        for (const c of commitments) {
          if (c.documentId === documentId) {
            await db.delete('aiCommitments', c.id).catch(() => {});
            LocalStoreSyncService.scheduleStoreDelete('aiCommitments', c.id);
          }
        }
      } catch { /* ignore */ }

      // 4. Delete aiThreads
      try {
        const threads = await db.getAll('aiThreads');
        for (const t of threads) {
          if ((t as { documentId?: string }).documentId === documentId) {
            await db.delete('aiThreads', t.id).catch(() => {});
            LocalStoreSyncService.scheduleStoreDelete('aiThreads', t.id);
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
              LocalStoreSyncService.scheduleStoreDelete('lifeStory', entry.eventDate);
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
              LocalStoreSyncService.scheduleStoreDelete('aiThemeLedger', record.id);
            } else {
              await db.put('aiThemeLedger', { ...record, evidence: filteredEv, count: newCount }).catch(() => {});
            }
          }
        }
      } catch { /* ignore */ }

      // 7. Clean aiProfileFacets and invalidate portrait if modified
      let facetsChanged = false;
      await withFacetLock(async () => {
        try {
          const facets = await db.getAll('aiProfileFacets');
          const tx = db.transaction('aiProfileFacets', 'readwrite');
          for (const f of facets) {
            if (f.noteIds.includes(documentId)) {
              facetsChanged = true;
              f.noteIds = f.noteIds.filter(nid => nid !== documentId);
              f.noteCount = Math.max(0, (f.noteCount ?? 1) - 1);
              f.dirty = true;
              f.updatedAt = Date.now();
              if (f.noteIds.length === 0 && (!f.dialogueIds || f.dialogueIds.length === 0)) {
                await tx.store.delete(f.id);
                LocalStoreSyncService.scheduleStoreDelete('aiProfileFacets', f.id);
              } else {
                await tx.store.put(f);
                LocalStoreSyncService.scheduleStoreSync('aiProfileFacets', f.id);
              }
            }
          }
          await tx.done;
        } catch { /* ignore */ }
      });

      if (facetsChanged) {
        try {
          await db.delete('aiPortrait', 'singleton');
          LocalStoreSyncService.scheduleStoreDelete('aiPortrait', 'singleton');
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('ai_user_portrait');
            // Кэш портрета привязан к аккаунту — снести надо и его копию.
            for (const k of Object.keys(localStorage)) {
              if (k.startsWith('ai_user_portrait_')) localStorage.removeItem(k);
            }
            localStorage.removeItem('ai_portrait_sections');
          }
        } catch { /* ignore */ }
      }

      // 8. Clean aiBeliefs evidence
      try {
        const beliefs = await db.getAll('aiBeliefs');
        const tx = db.transaction('aiBeliefs', 'readwrite');
        for (const raw of beliefs) {
          const b = raw as { id?: string; evidence?: Array<{ id?: string; noteId?: string }>; clusterSize?: number; updatedAt?: number };
          if (!b.id) continue;
          const evidence = Array.isArray(b.evidence) ? b.evidence : [];
          const hasEvidence = evidence.some(e => e.noteId === documentId || e.id === documentId);
          if (hasEvidence) {
            const filteredEv = evidence.filter(e => e.noteId !== documentId && e.id !== documentId);
            if (filteredEv.length === 0) {
              await tx.store.delete(b.id);
              LocalStoreSyncService.scheduleStoreDelete('aiBeliefs', b.id);
            } else {
              b.evidence = filteredEv;
              b.clusterSize = filteredEv.length;
              b.updatedAt = Date.now();
              await tx.store.put(b);
              LocalStoreSyncService.scheduleStoreSync('aiBeliefs', b.id);
            }
          }
        }
        await tx.done;
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

  /** Сдвигает день заметки. Начало истории меняется только когда попросят:
   *  firstSessionAt заякоривает стрики и «давность», и молча переписывать его
   *  — значит переписывать прошлое. */
  async updateDate(
    id: string,
    dates: { lastSessionAt: number; firstSessionAt?: number },
  ): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction(['documents', 'versions'], 'readwrite');
    const existing = await tx.objectStore('documents').get(id);
    if (!existing) { await tx.done; return; }
    const nextFirst = dates.firstSessionAt ?? existing.firstSessionAt;
    await tx.objectStore('documents').put({ ...existing, firstSessionAt: nextFirst, lastSessionAt: dates.lastSessionAt });
    if (dates.firstSessionAt !== undefined && dates.firstSessionAt !== existing.firstSessionAt) {
      const versions = await tx.objectStore('versions').index('by-document').getAll(id);
      versions.sort((a, b) => a.version - b.version);
      const first = versions[0];
      // Версию #1 двигаем только если она всё ещё привязана к прежнему началу:
      // иначе затираем честную временную метку более поздней правки.
      if (first && first.sessionStartedAt === existing.firstSessionAt) {
        first.sessionStartedAt = dates.firstSessionAt;
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
    // Появилась связь — значит заметка больше не «только на устройстве».
    // Оставить флаг рядом с живой связью значит оставить противоречие: она
    // и связана, и объявлена локальной, и следующий проход её пропустит.
    const { localOnly: _dropped, unlinkedByTombstone: _dropped2, ...rest } = existing;
    await tx.store.put(cloudId ? { ...rest, linkedCloudId: cloudId } : { ...existing, linkedCloudId: cloudId });
    await tx.done;
  },

  // Deliberate unlink: drops the link AND records that it was intentional, so
  // the re-link pass leaves this note alone.
  async unlinkFromCloud(id: string, reason?: 'user_choice' | 'tombstone'): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({
      ...existing,
      linkedCloudId: '',
      localOnly: true,
      unlinkedByTombstone: reason === 'tombstone',
    });
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

  async updateExcludedFromAI(id: string, excludedFromAI: boolean): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({ ...existing, excludedFromAI });
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

  /** Проставляет uuid заметкам, созданным до C1.1. Идемпотентно: заметку с уже
   *  заполненным uuid не трогает. Локальная операция — облако не читается, чтобы
   *  проход не стоил квоты чтений. */
  async backfillDocumentUuids(guestId: string): Promise<number> {
    const db = await getLocalDb();
    const docs = await db.getAllFromIndex('documents', 'by-guest', guestId);
    const missing = docs.filter(d => !d.uuid);
    if (missing.length === 0) return 0;

    const tx = db.transaction('documents', 'readwrite');
    await Promise.all(missing.map(d => tx.store.put({ ...d, uuid: randomUUID() })));
    await tx.done;
    return missing.length;
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
