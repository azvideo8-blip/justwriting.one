import { getLocalDb, LocalDocument, randomUUID } from '../storage/localDb';
import { invalidatePortrait } from '../ai/portraitEpoch';
import { reportError } from '../../shared/errors/reportError';
import { writeFacetStore } from './facetLock';
import { LocalStoreSyncService } from './LocalStoreSyncService';
import { DataProvider } from '../data';

/**
 * Сносит облачную копию производной ИИ, привязанной к заметке.
 *
 * Сводки и векторы лежат не в `local_store_records`, а в своих таблицах, и
 * очередь `scheduleStoreDelete` до них не достаёт. Ключ строки — ПОСТОЯННЫЙ
 * номер заметки: политика доступа в базе сверяет его с `documents.uuid`, и по
 * локальному `local_…` не удалится ничего.
 */
/** false — облачную копию удалить не удалось (N-51: это не «удалено»). */
async function deleteCloudDerivative(kind: 'summary' | 'embedding', canonicalId: string, ownerId?: string): Promise<boolean> {
  const uid = ownerId;
  if (!uid || uid.startsWith('guest_')) return false;
  try {
    if (kind === 'summary') await DataProvider.deleteSummary(uid, canonicalId);
    else await DataProvider.deleteEmbedding(uid, canonicalId);
    return true;
  } catch (e) {
    reportError(e, { action: `cascadeDelete_cloud_${kind}`, canonicalId, ownerId });
    return false;
  }
}

export interface DeleteDocumentCloudOptions {
  remove: true;
  cloudId?: string | undefined;
}

export const LocalDocumentService = {
  async createDocument(
    guestId: string,
    data: { title: string; tags?: string[] | undefined; labelId?: string | undefined; uuid?: string | undefined; firstSessionAt?: number | undefined; lastSessionAt?: number | undefined; mood?: string | undefined; excludedFromAI?: boolean | undefined; _locked?: boolean | undefined; _decryptionError?: boolean | undefined }
  ): Promise<string> {
    if (data._locked || data._decryptionError) {
      throw new Error('LOCKED: cannot save locked document to local storage');
    }
    const db = await getLocalDb(guestId);
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

  async getDocument(id: string, ownerId?: string): Promise<LocalDocument | undefined> {
    const db = await getLocalDb(ownerId);
    return db.get('documents', id) ?? undefined;
  },

  async getDocumentsByOwner(ownerId: string): Promise<LocalDocument[]> {
    const db = await getLocalDb(ownerId);
    const all = await db.getAllFromIndex('documents', 'by-guest', ownerId);
    return all.sort((a, b) => b.lastSessionAt - a.lastSessionAt);
  },

  async updateAfterSession(
    id: string,
    data: { totalWords: number; totalDuration: number; currentVersion: number; mood?: string | undefined },
    ownerId?: string
  ): Promise<void> {
    const db = await getLocalDb(ownerId);
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
    data: {
      totalWords?: number;
      totalDuration?: number;
      currentVersion?: number;
      sessionsCount?: number;
      lastSyncedCloudVersion?: number;
      lastSeenCloudUpdatedAt?: string;
      title?: string;
      tags?: string[];
      labelId?: string | undefined;
      mood?: string | undefined;
      excludedFromAI?: boolean | undefined;
      /** R3-5: число — в корзине с этого момента; null — не в корзине. */
      trashedAt?: number | null;
    },
    ownerId?: string
  ): Promise<void> {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    const base = { ...existing };
    if (data.trashedAt === null) delete base.trashedAt;
    else if (data.trashedAt !== undefined) base.trashedAt = data.trashedAt;
    await tx.store.put({
      ...base,
      ...(data.totalWords !== undefined && { totalWords: data.totalWords }),
      ...(data.totalDuration !== undefined && { totalDuration: data.totalDuration }),
      ...(data.currentVersion !== undefined && { currentVersion: data.currentVersion }),
      ...(data.sessionsCount !== undefined && { sessionsCount: data.sessionsCount }),
      ...(data.lastSyncedCloudVersion !== undefined && { lastSyncedCloudVersion: data.lastSyncedCloudVersion }),
      ...(data.lastSeenCloudUpdatedAt !== undefined && { lastSeenCloudUpdatedAt: data.lastSeenCloudUpdatedAt }),
      ...(data.title !== undefined && { title: data.title }),
      ...(data.tags !== undefined && { tags: data.tags }),
      ...(data.labelId !== undefined && { labelId: data.labelId }),
      ...(data.mood !== undefined && { mood: data.mood }),
      ...(data.excludedFromAI !== undefined && { excludedFromAI: data.excludedFromAI }),
    });
    await tx.done;
  },

  /** true — заметка и все её производные удалены; false — заметка удалена, а
   *  часть разборов ИИ (локально или в облаке) нет (N-51).
   *
   *  @param cloud Явный параметр облачного удаления. Если задан `cloud.remove`,
   *    задача на снос облачной копии (`cloud.cloudId ?? doc?.linkedCloudId`)
   *    ставится в очередь ЭТИМ ЖЕ транзакционным проходом, что и снос локальной
   *    строки (SB-2). Раньше при сбое предварительного чтения (F-023) облачное
   *    удаление терялось, возвращая заметку при синхронизации. Теперь при
   *    `cloud.remove` идентификаторы берутся из прочитанного документа в транзакции.
   *    Когда параметр отсутствует (removeLocalCopy, откат загрузки),
   *    ничего в очередь не ставится — облако остаётся намеренно. */
  async deleteDocument(id: string, ownerId?: string, cloud?: DeleteDocumentCloudOptions): Promise<boolean> {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction(['documents', 'versions', 'syncQueue'], 'readwrite');
    const verStore = tx.objectStore('versions');
    const docStore = tx.objectStore('documents');
    const queueStore = tx.objectStore('syncQueue');
    const versions = await verStore.index('by-document').getAll(id);
    const doc = await docStore.get(id);

    const allQueue = await queueStore.getAll();
    const docUuid = doc?.uuid;
    const linkedCloudId = doc?.linkedCloudId;
    // Строку живого замка не трогаем: её снимает владелец. Удалённая, она
    // гасила heartbeat чужой выгрузки и отдавала документ второму писателю (R3-008).
    const matchingTasks = allQueue.filter(
      t => !t.id.startsWith('lock_cloud_') && (
           t.documentId === id ||
           (Boolean(docUuid) && t.documentId === docUuid) ||
           (Boolean(linkedCloudId) && t.documentId === linkedCloudId))
    );

    const targetCloudId = cloud?.remove ? (cloud.cloudId ?? doc?.linkedCloudId) : undefined;
    const targetOwner = ownerId ?? doc?.guestId;

    await Promise.all([
      ...versions.map(v => verStore.delete(v.id)),
      ...matchingTasks.map(t => queueStore.delete(t.id)),
      ...(targetCloudId && targetOwner
        ? [queueStore.put({
            id: `delete_${targetCloudId}_${Date.now()}`,
            documentId: targetCloudId,
            type: 'delete' as const,
            createdAt: Date.now(),
            ownerId: targetOwner,
          })]
        : []),
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
    const effectiveOwner = ownerId ?? doc?.guestId;
    return LocalDocumentService.cascadeDeleteAIDerivatives(id, doc?.uuid, effectiveOwner);
  },

  /**
   * @param canonicalUuid Постоянный номер заметки, снятый ДО её удаления.
   *   Обязателен, когда заметки в хранилище уже нет: облачные строки сводки и
   *   вектора ключуются им, и по локальному номеру не удалится ничего.
   */
  async cascadeDeleteAIDerivatives(documentId: string, canonicalUuid?: string, ownerId?: string): Promise<boolean> {
    // N-51: каждый сбой считается — удаление производных сообщает, прошло ли оно.
    let failed = 0;
    const fail = () => { failed++; };
    try {
      const db = await getLocalDb(ownerId);

      const doc = canonicalUuid ? undefined : await db.get('documents', documentId).catch(() => undefined);
      const canonicalId = canonicalUuid ?? doc?.uuid;
      const effectiveOwnerId = ownerId ?? doc?.guestId;

      // 1. Delete aiSummaries, aiEmbeddings, aiTimeline
      await Promise.all([
        db.delete('aiSummaries', documentId).catch(fail),
        db.delete('aiEmbeddings', documentId).catch(fail),
        db.delete('aiTimeline', documentId).catch(fail),
      ]);
      // Облачные копии тех же трёх. Локального удаления мало: восстановление
      // из облака вернуло бы разбор удалённой заметки обратно на устройство.
      LocalStoreSyncService.scheduleStoreDelete('aiTimeline', documentId);
      if (canonicalId) {
        const cloud = await Promise.all([
          deleteCloudDerivative('summary', canonicalId, effectiveOwnerId),
          deleteCloudDerivative('embedding', canonicalId, effectiveOwnerId),
        ]);
        if (cloud.includes(false)) fail();
      } else {
        // Постоянного номера нет ни здесь, ни у вызывающего: удалять в облаке
        // нечем. Молчать нельзя — иначе разбор удалённой заметки останется там
        // навсегда, и узнать об этом будет неоткуда.
        reportError(
          new Error('cascadeDelete: canonical uuid unavailable, cloud derivatives left behind'),
          { action: 'cascadeDeleteAIDerivatives_noUuid', documentId },
          'warning',
        );
        fail();
      }

      // 2. Delete aiDialogues & related aiChatMemory
      try {
        const dialogues = await db.getAllFromIndex('aiDialogues', 'by-document', documentId);
        for (const d of dialogues) {
          try {
            const memories = await db.getAllFromIndex('aiChatMemory', 'by-dialogue', d.id);
            for (const m of memories) {
              await db.delete('aiChatMemory', m.id).catch(fail);
              LocalStoreSyncService.scheduleStoreDelete('aiChatMemory', m.id);
            }
          } catch { fail(); }
          await db.delete('aiDialogues', d.id).catch(fail);
          LocalStoreSyncService.scheduleStoreDelete('aiDialogues', d.id);
        }
      } catch { fail(); }

      // 3. Delete aiCommitments
      try {
        const commitments = await db.getAll('aiCommitments');
        for (const c of commitments) {
          if (c.documentId === documentId) {
            await db.delete('aiCommitments', c.id).catch(fail);
            LocalStoreSyncService.scheduleStoreDelete('aiCommitments', c.id);
          }
        }
      } catch { fail(); }

      // 4. Delete aiThreads
      try {
        const threads = await db.getAll('aiThreads');
        for (const t of threads) {
          if ((t as { documentId?: string }).documentId === documentId) {
            await db.delete('aiThreads', t.id).catch(fail);
            LocalStoreSyncService.scheduleStoreDelete('aiThreads', t.id);
          }
        }
      } catch { fail(); }

      // 5. Clean lifeStory entries
      try {
        const lifeEntries = await db.getAll('lifeStory');
        for (const entry of lifeEntries) {
          if (entry.sourceDocumentIds?.includes(documentId)) {
            const updatedSources = entry.sourceDocumentIds.filter(sid => sid !== documentId);
            if (updatedSources.length === 0) {
              await db.delete('lifeStory', entry.eventDate).catch(fail);
              LocalStoreSyncService.scheduleStoreDelete('lifeStory', entry.eventDate);
            } else {
              await db.put('lifeStory', { ...entry, sourceDocumentIds: updatedSources }).catch(fail);
            }
          }
        }
      } catch { fail(); }


      // 6. Clean aiThemeLedger evidence & records
      try {
        const themeRecords = await db.getAll('aiThemeLedger');
        for (const record of themeRecords) {
          const hasEvidence = record.evidence.some(e => e.noteId === documentId);
          if (hasEvidence) {
            const filteredEv = record.evidence.filter(e => e.noteId !== documentId);
            const newCount = Math.max(0, record.count - 1);
            if (filteredEv.length === 0 || newCount === 0) {
              await db.delete('aiThemeLedger', record.id).catch(fail);
              LocalStoreSyncService.scheduleStoreDelete('aiThemeLedger', record.id);
            } else {
              await db.put('aiThemeLedger', { ...record, evidence: filteredEv, count: newCount }).catch(fail);
            }
          }
        }
      } catch { fail(); }

      // 7. Clean aiProfileFacets and invalidate portrait if modified
      let facetsChanged = false;
      await writeFacetStore(async (store) => {
        try {
          const facets = await store.getAll();
          const tx = store.transaction();
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
        } catch { fail(); }
      });

      if (facetsChanged) {
        try {
          invalidatePortrait();
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
        } catch { fail(); }
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
      } catch { fail(); }
    } catch (e) {
      reportError(e, { action: 'cascadeDeleteAIDerivatives', documentId });
      fail();
    }
    return failed === 0;
  },


  async updateTags(id: string, tags: string[], ownerId?: string): Promise<void> {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({ ...existing, tags });
    await tx.done;
  },

  async updateTitle(id: string, title: string, ownerId?: string): Promise<void> {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({ ...existing, title });
    await tx.done;
  },

  async trashDocument(id: string, trashedAt: number = Date.now(), ownerId?: string): Promise<void> {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({ ...existing, trashedAt });
    await tx.done;
  },

  async restoreDocument(id: string, ownerId?: string): Promise<void> {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    const updated = { ...existing };
    delete updated.trashedAt;
    await tx.store.put(updated);
    await tx.done;
  },

  /** Сдвигает день заметки. Начало истории меняется только когда попросят:
   *  firstSessionAt заякоривает стрики и «давность», и молча переписывать его
   *  — значит переписывать прошлое. */
  async updateDate(
    id: string,
    dates: { lastSessionAt: number; firstSessionAt?: number },
    ownerId?: string,
  ): Promise<void> {
    const db = await getLocalDb(ownerId);
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

  /**
   * Сменить постоянный номер заметки.
   *
   * Нужно ровно в одном случае (LIFE-10): прежний номер занят надгробием, а
   * надгробие неизменяемо, — и человек осознанно просит новую облачную копию.
   * Производные ИИ хранятся локально по id заметки, а в облако уходят с
   * номером, который берётся в момент выгрузки, так что смена номера их не
   * рвёт; облачных производных у похороненного номера не осталось — их сносит
   * удаление, до того как поставит надгробие.
   */
  async updateDocumentUuid(id: string, uuid: string, ownerId?: string): Promise<void> {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({ ...existing, uuid });
    await tx.done;
  },

  async updateLinkedCloudId(id: string, cloudId: string, ownerId?: string): Promise<void> {
    const db = await getLocalDb(ownerId);
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
  async unlinkFromCloud(id: string, reason?: 'user_choice' | 'tombstone', ownerId?: string): Promise<void> {
    const db = await getLocalDb(ownerId);
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

  /**
   * D-5: явное «Загрузить на облако» по заметке, которую пользователь ранее сам
   * снял с облака («Удалить облачную копию»), — это сменившийся выбор, а не обход
   * прошлого. Снимает пометку только у заметки без `unlinkedByTombstone`: у той,
   * чью облачную копию удалили, связь с могилкой должна остаться, иначе
   * повторная загрузка «воскресит» удаление под новым id.
   * Автоматические проходы (sweep, re-link, фоновая синхронизация) этот метод не
   * вызывают и пометку уважают по-прежнему.
   */
  async clearLocalOnlyForUpload(id: string, ownerId?: string): Promise<boolean> {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing || !existing.localOnly || existing.unlinkedByTombstone) {
      await tx.done;
      return false;
    }
    await tx.store.put({ ...existing, localOnly: false });
    await tx.done;
    return true;
  },

  async updateLabelId(id: string, labelId: string | undefined, ownerId?: string): Promise<void> {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({ ...existing, labelId: labelId ?? undefined });
    await tx.done;
  },

  /** R3-1: метаданные этой заметки нужно дослать в облако (см. metadataDirty). */
  async setMetadataDirty(id: string, dirty: boolean, ownerId?: string): Promise<void> {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({ ...existing, metadataDirty: dirty || undefined });
    await tx.done;
  },

  async updateExcludedFromAI(id: string, excludedFromAI: boolean, ownerId?: string): Promise<void> {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) { await tx.done; return; }
    await tx.store.put({ ...existing, excludedFromAI });
    await tx.done;
  },

  async migrateDocumentOwner(documentId: string, newOwnerId: string, ownerId?: string): Promise<void> {
    const db = await getLocalDb(ownerId);
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
    const db = await getLocalDb(guestId);
    const docs = await db.getAllFromIndex('documents', 'by-guest', guestId);
    const missing = docs.filter(d => !d.uuid);
    if (missing.length === 0) return 0;

    const tx = db.transaction('documents', 'readwrite');
    await Promise.all(missing.map(d => tx.store.put({ ...d, uuid: randomUUID() })));
    await tx.done;
    return missing.length;
  },

  async _updateProfile(guestId: string): Promise<void> {
    const db = await getLocalDb(guestId);
    const docs = await LocalDocumentService.getDocumentsByOwner(guestId);

    // EA-6: пересчитываем только счётчики. Голый put без остальных полей
    // стирал метки профиля (их пишет импорт архива) при каждом удалении заметки.
    const existing = await db.get('profile', guestId);
    await db.put('profile', {
      ...existing,
      guestId,
      totalWords: docs.reduce((s, d) => s + d.totalWords, 0),
      sessionsCount: docs.reduce((s, d) => s + d.sessionsCount, 0),
      totalDuration: docs.reduce((s, d) => s + d.totalDuration, 0),
      lastSessionAt: docs[0]?.lastSessionAt ?? Date.now(),
    });
  },

  async clearLabelFromAllDocs(userId: string, labelId: string): Promise<void> {
    const db = await getLocalDb(userId);
    const all = await db.getAllFromIndex('documents', 'by-guest', userId);
    const matching = all.filter(d => d.labelId === labelId);
    if (matching.length === 0) return;
    const tx = db.transaction('documents', 'readwrite');
    await Promise.all(matching.map(d => tx.store.put({ ...d, labelId: undefined })));
    await tx.done;
  },

  async renameTagInAllDocs(userId: string, oldTag: string, newTag: string): Promise<void> {
    const db = await getLocalDb(userId);
    const all = await db.getAllFromIndex('documents', 'by-guest', userId);
    const matching = all.filter(d => Array.isArray(d.tags) && d.tags.includes(oldTag));
    if (matching.length === 0) return;
    const tx = db.transaction('documents', 'readwrite');
    await Promise.all(matching.map(d => tx.store.put({ ...d, tags: (d.tags ?? []).map(t => t === oldTag ? newTag : t) })));
    await tx.done;
  },

  async removeTagFromAllDocs(userId: string, tag: string): Promise<void> {
    const db = await getLocalDb(userId);
    const all = await db.getAllFromIndex('documents', 'by-guest', userId);
    const matching = all.filter(d => Array.isArray(d.tags) && d.tags.includes(tag));
    if (matching.length === 0) return;
    const tx = db.transaction('documents', 'readwrite');
    await Promise.all(matching.map(d => tx.store.put({ ...d, tags: (d.tags ?? []).filter(t => t !== tag) })));
    await tx.done;
  },

  async getProfile(guestId: string) {
    const db = await getLocalDb(guestId);
    return db.get('profile', guestId);
  },

  // Reconcile sessionsCount for all documents of a user/guest by recounting
  // actual version rows. Fixes drift from the incremental update approach.
  async reconcileSessionsCount(guestId: string): Promise<{ docsFixed: number; profileFixed: boolean }> {
    const db = await getLocalDb(guestId);
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
