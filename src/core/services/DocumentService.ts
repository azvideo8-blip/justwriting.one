import { DataProvider } from '../data';
import type { MetadataField } from '../storage/localDb';
import { isSyncPushMissing } from '../data/providers';
import { syncPushRpcEnabled, markSyncPushUnavailable } from '../sync/syncFlags';
import { queueStatsDelta, pendingStatsDeltas, clearStatsDeltas, markStatsDeltaQueued } from './pendingDelta';
import { Document } from '../../types';
import { toTimestampMs } from '../utils/dateUtils';
import { reportError } from '../../shared/errors/reportError';
import { documentDbSchema } from '../data/schemas';
import { documentFromDb } from './mappers';
import { maybeEncrypt, maybeDecrypt, DecryptionError } from '../crypto/cryptoHelpers';

/**
 * S0-5 (класс A): облачный ряд ЕСТЬ, но не разбирается схемой. Это не «ряда
 * нет»: вызывающие, которые по `null` заводят второй облачный документ
 * (`addCloudCopy:841-844 → 1157`), плодят дубли живой заметки, а третье
 * устройство получает две копии одного текста. Провал разбора — ошибка.
 */
export class UnreadableCloudRowError extends Error {
  constructor(documentId: string, kind: 'getDocument' | 'getDocumentWithDeleted') {
    super(`UNREADABLE_CLOUD_ROW: ${kind}: document ${documentId} does not match the schema`);
    this.name = 'UnreadableCloudRowError';
  }
}

/**
 * S1-10: списочный читатель не отдаёт неполный список молча. Ряд, который не
 * прошёл схему или не расшифровался неожиданной ошибкой, раньше превращался в
 * `null` и тихо выпадал из списка — курсор изменений уезжал за неприменённое
 * изменение, «нет в списке» читалось как «прочитано целиком». Теперь список с
 * такими рядами — ошибка уровня списка: `ids` нечитаемых и `docs` — прочитанная
 * часть, по которой перепривязка всё ещё вправе связать совпавшие uuid.
 */
export class UnreadableCloudListError extends Error {
  readonly ids: string[];
  readonly docs: Document[];
  /** R-1: uuid сырых нечитаемых рядов — только с ними может совпасть несвязанная
   *  локальная заметка; остальные несвязанные дренаж не ждёт. */
  readonly uuids: string[];
  /** C1: `firstSessionAt` сырых нечитаемых рядов — пара по времени для старых
   *  несвязанных заметок без uuid или с другим uuid. */
  readonly starts: number[];
  /** C1: есть нечитаемый ряд без uuid и без времени — с ним может совпасть любая
   *  несвязанная заметка, откладываются все. */
  readonly blind: boolean;
  constructor(ids: string[], docs: Document[], uuids: string[] = [], starts: number[] = [], blind = false) {
    super(`UNREADABLE_CLOUD_LIST: ${ids.length} unreadable row(s): ${ids.join(', ')}`);
    this.name = 'UnreadableCloudListError';
    this.ids = ids;
    this.docs = docs;
    this.uuids = uuids;
    this.starts = starts;
    this.blind = blind;
  }
}


/**
 * S1-6: одна строка облака → Document — тем же путём, что и полный список:
 * расшифровка, страж нечитаемой строки, схема. Вынесено из getUserDocuments,
 * чтобы забор по rev не заводил вторую копию правила разбора.
 */
export async function parseCloudDocument(d: Record<string, unknown>): Promise<Document | null> {
  let _locked = false;
  let _decryptionError = false;
  let decrypted: Record<string, unknown> = d;
  try {
    decrypted = await maybeDecrypt(d, ['title', 'mood'], ['tags']);
  } catch (decErr) {
    if (decErr instanceof DecryptionError) {
      _decryptionError = true;
    } else if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) {
      _locked = true;
    } else {
      reportError(decErr, { action: 'getUserDocuments_decrypt', docId: d.id as string });
      return null;
    }
  }
  const docData: Record<string, unknown> = { ...decrypted };
  if (_locked || _decryptionError) {
    delete docData.title;
    delete docData.tags;
    delete docData.mood;
    if (_locked) docData._locked = true;
    if (_decryptionError) docData._decryptionError = true;
  }
  const parsed = documentDbSchema.safeParse({ id: d.id, ...docData });
  if (!parsed.success) {
    reportError(parsed.error, { action: 'getUserDocuments_parse', docId: d.id as string });
    return null;
  }
  return documentFromDb(parsed.data);
}

export const DocumentService = {
  async createDocument(
    userId: string,
    data: Pick<Document, 'title' | 'tags' | 'labelId'> & {
      uuid?: string | undefined;
      firstSessionAt?: Date | undefined;
      lastSessionAt?: Date | undefined;
      mood?: string | undefined;
      excludedFromAI?: boolean | undefined;
      currentVersion?: number | undefined;
      totalWords?: number | undefined;
      totalDuration?: number | undefined;
      sessionsCount?: number | undefined;
      trashedAt?: Date | undefined;
      _locked?: boolean | undefined;
      _decryptionError?: boolean | undefined;
    }
  ): Promise<string> {
    if (data._locked || data._decryptionError) {
      throw new Error('LOCKED: cannot create locked document in cloud');
    }
    const rawPayload: Record<string, unknown> = {
      title: data.title ?? '',
      currentVersion: data.currentVersion ?? 0,
      totalWords: data.totalWords ?? 0,
      totalDuration: data.totalDuration ?? 0,
      sessionsCount: data.sessionsCount ?? 0,
      firstSessionAt: data.firstSessionAt ? data.firstSessionAt.getTime() : Date.now(),
      lastSessionAt: data.lastSessionAt ? data.lastSessionAt.getTime() : Date.now(),
      tags: data.tags ?? [],
      labelId: data.labelId ?? null,
      mood: data.mood ?? null,
      excludedFromAI: data.excludedFromAI ?? false,
      // N2-3: заметку, отправленную в корзину до первой выгрузки, облако
      // получает сразу в корзине — иначе другие устройства видели её живой.
      ...(data.trashedAt ? { trashedAt: data.trashedAt } : {}),
    };
    if (data.uuid) rawPayload.uuid = data.uuid;

    const payload = await maybeEncrypt(rawPayload, ['title', 'mood'], ['tags'], userId);
    return DataProvider.createDocument(userId, payload);
  },

  async findByUuid(userId: string, uuid: string): Promise<Document | null> {
    return DocumentService.getDocument(userId, uuid);
  },

  async getDocument(userId: string, documentId: string): Promise<Document | null> {
    const data = await DataProvider.getDocument(userId, documentId);
    if (!data) return null;
    let decrypted: Record<string, unknown> = data;
    let _locked = false;
    let _decryptionError = false;
    try {
      decrypted = await maybeDecrypt(data, ['title', 'mood'], ['tags']);
    } catch (decErr) {
      if (decErr instanceof DecryptionError) {
        _decryptionError = true;
      } else if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) {
        _locked = true;
      } else {
        reportError(decErr, { action: 'getDocument_decrypt', docId: documentId });
        return null;
      }
    }
    const docData: Record<string, unknown> = { ...decrypted };
    if (_locked || _decryptionError) {
      delete docData.title;
      delete docData.tags;
      delete docData.mood;
      if (_locked) docData._locked = true;
      if (_decryptionError) docData._decryptionError = true;
    }
    const parsed = documentDbSchema.safeParse({ id: documentId, ...docData });
    if (!parsed.success) {
      reportError(parsed.error, { action: 'getDocument_parse', docId: documentId });
      // S0-5: «не разобралось» ≠ «нет». Null читался вызывающим как «облачного
      // ряда нет», и addCloudCopy заводил второй документ поверх живого.
      throw new UnreadableCloudRowError(documentId, 'getDocument');
    }
    return documentFromDb(parsed.data);
  },

  async getDocumentWithDeleted(userId: string, documentId: string): Promise<Document | null> {
    const data = await DataProvider.getDocumentWithDeleted(userId, documentId);
    if (!data) return null;
    let decrypted: Record<string, unknown> = data;
    let _locked = false;
    let _decryptionError = false;
    try {
      decrypted = await maybeDecrypt(data, ['title', 'mood'], ['tags']);
    } catch (decErr) {
      if (decErr instanceof DecryptionError) {
        _decryptionError = true;
      } else if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) {
        _locked = true;
      } else {
        reportError(decErr, { action: 'getDocument_decrypt', docId: documentId });
        return null;
      }
    }
    const docData: Record<string, unknown> = { ...decrypted };
    if (_locked || _decryptionError) {
      delete docData.title;
      delete docData.tags;
      delete docData.mood;
      if (_locked) docData._locked = true;
      if (_decryptionError) docData._decryptionError = true;
    }
    const parsed = documentDbSchema.safeParse({ id: documentId, ...docData });
    if (!parsed.success) {
      reportError(parsed.error, { action: 'getDocument_parse', docId: documentId });
      // S0-5: то же для чтения вместе с надгробиями: «не разобрано» не значит
      // «строки нет», иначе удаление заметки в облаке превращается в отсутствие.
      throw new UnreadableCloudRowError(documentId, 'getDocumentWithDeleted');
    }
    return documentFromDb(parsed.data);
  },

  async getUserDocuments(userId: string): Promise<Document[]> {
    const records = await DataProvider.getUserDocuments(userId);
    const decryptedDocs = await Promise.all(records.map(parseCloudDocument));
    const docs: Document[] = [];
    // S1-10: `_locked`/`_decryptionError` идут дальше с флагами — это
    // «прочитали, но закрыто»; сюда попадает только ряд, который разобрать
    // не удалось. Неполный список не отдаётся как полный.
    const unreadable: string[] = [];
    const unreadableUuids: string[] = [];
    const unreadableStarts: number[] = [];
    let blind = false;
    decryptedDocs.forEach((d, i) => {
      if (d !== null) { docs.push(d); return; }
      unreadable.push(String(records[i]!.id));
      const uuid = records[i]!.uuid;
      const start = toTimestampMs(records[i]!.firstSessionAt as never);
      if (typeof uuid === 'string' && uuid) unreadableUuids.push(uuid);
      if (start != null && Number.isFinite(start)) unreadableStarts.push(start);
      else if (!(typeof uuid === 'string' && uuid)) blind = true;
    });
    docs.sort((a, b) => (toTimestampMs(b.lastSessionAt) ?? 0) - (toTimestampMs(a.lastSessionAt) ?? 0));
    if (unreadable.length > 0) throw new UnreadableCloudListError(unreadable, docs, unreadableUuids, unreadableStarts, blind);
    return docs;
  },


  async getCloudDocumentVersions(userId: string): Promise<Map<string, number>> {
    try {
      const records = await DataProvider.getUserDocuments(userId);
      const map = new Map<string, number>();
      for (const r of records) {
        const id = (r.uuid as string) || (r.id as string);
        if (id) {
          map.set(id, typeof r.currentVersion === 'number' ? r.currentVersion : 0);
        }
      }
      return map;
    } catch {
      const docs = await DocumentService.getUserDocuments(userId);
      const map = new Map<string, number>();
      for (const d of docs) {
        if (d.id) {
          map.set(d.id, d.currentVersion ?? 0);
        }
      }
      return map;
    }
  },

  async getCloudVersionDiscrepancyCount(userId: string): Promise<number> {
    // R4-7: ошибку не глотаем — диагностика показывает «облако не прочитано».
    if (typeof DataProvider.getCloudVersionDiscrepancyCount === 'function') {
      return DataProvider.getCloudVersionDiscrepancyCount(userId);
    }
    return 0;
  },

  async updateDocumentAfterSession(
    userId: string,
    documentId: string,
    data: {
      totalWords: number;
      /** V-5: длительность именно этой выгрузки; складывает сервер (0039). */
      durationDelta: number;
      currentVersion: number;
      mood?: string | undefined;
      /** R7Q-003: приращение за эту выгрузку, не абсолют из локальной копии. */
      sessionsDelta?: number | undefined;
      lastSessionAt?: Date | undefined;
    }
  ): Promise<number | null> {
    const payload: Parameters<typeof DataProvider.updateDocumentSessionStats>[2] = {
      totalWords: data.totalWords,
      durationDelta: data.durationDelta,
      currentVersion: data.currentVersion,
      mood: data.mood ?? null,
    };
    if (data.sessionsDelta !== undefined) payload.sessionsDelta = data.sessionsDelta;
    if (data.lastSessionAt !== undefined) payload.lastSessionAt = data.lastSessionAt;

    if (data.mood) {
      const encrypted = await maybeEncrypt({ mood: data.mood }, ['mood'], [], userId);
      payload.mood = (encrypted.mood as string) ?? null;
      if (encrypted._encrypted === true) payload.moodEncrypted = true;
    }

    if (!(await syncPushRpcEnabled(userId))) {
      return DataProvider.updateDocumentSessionStats(userId, documentId, payload);
    }

    // S2-7: прибавка — в журнал до отправки; с этого момента её секунды живут там,
    // и ошибка помечается, чтобы вызывающий не положил их долгом второй раз.
    const { entry, queued } = queueStatsDelta(userId, documentId, {
      sessions: Math.max(0, payload.sessionsDelta ?? 1),
      duration: Math.floor(payload.durationDelta),
      words: Math.max(0, Math.floor(payload.totalWords)),
    });
    try {
      // Ревью SYNC2: журнал мог не записаться — свежая прибавка едет из памяти,
      // иначе отправка уходила пустой и сессия молча терялась.
      const pending = pendingStatsDeltas(userId, documentId);
      if (!pending.some(d => d.opId === entry.opId)) pending.push(entry);
      let results;
      try {
        results = await DataProvider.syncPush(pending.map(d => ({
          table: 'documents' as const, op: 'delta' as const, uuid: documentId, op_id: d.opId,
          sessions: d.sessions, duration: d.duration, words: d.words,
        })));
      } catch (e) {
        if (!isSyncPushMissing(e)) throw e;
        // Сервер без 0047: старый путь до конца сессии, журнал сливается одной дельтой.
        markSyncPushUnavailable(userId);
        const written = await DataProvider.updateDocumentSessionStats(userId, documentId, {
          ...payload,
          sessionsDelta: pending.reduce((n, d) => n + d.sessions, 0),
          durationDelta: pending.reduce((n, d) => n + d.duration, 0),
        });
        // Ревью SYNC2: журнал снимается после записи старым путём, а не до неё —
        // упавшая запись оставляет прибавки для следующей попытки.
        clearStatsDeltas(userId, pending.map(d => d.opId));
        return written;
      }
      // missing (заметки в облаке ещё нет) остаётся в журнале до следующей выгрузки.
      clearStatsDeltas(userId, pending.filter((_, i) => results[i]!.status !== 'missing').map(d => d.opId));
      const meta: Parameters<typeof DataProvider.updateDocumentSessionMeta>[2] = { currentVersion: payload.currentVersion };
      if (payload.mood !== undefined) meta.mood = payload.mood;
      if (payload.moodEncrypted !== undefined) meta.moodEncrypted = payload.moodEncrypted;
      if (payload.lastSessionAt !== undefined) meta.lastSessionAt = payload.lastSessionAt;
      return await DataProvider.updateDocumentSessionMeta(userId, documentId, meta);
    } catch (e) {
      if (queued) markStatsDeltaQueued(e);
      throw e;
    }
  },

  async updateTags(userId: string, documentId: string, tags: string[]): Promise<void> {
    const encrypted = await maybeEncrypt({ tags }, [], ['tags'], userId);
    await DataProvider.updateDocument(userId, documentId, encrypted);
  },

  async updateTitle(userId: string, documentId: string, title: string): Promise<void> {
    const encrypted = await maybeEncrypt({ title }, ['title'], [], userId);
    await DataProvider.updateDocument(userId, documentId, encrypted);
  },

  /** Облачный двойник LocalDocumentService.updateDate: начало истории меняется
   *  только явно, иначе следующий синк принёс бы затёртое значение обратно. */
  async updateDate(
    userId: string,
    documentId: string,
    dates: { lastSessionAt: Date; firstSessionAt?: Date },
  ): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, {
      lastSessionAt: dates.lastSessionAt.getTime(),
      ...(dates.firstSessionAt !== undefined ? { firstSessionAt: dates.firstSessionAt.getTime() } : {}),
    });
  },

  /** R3-1: повтор неудавшейся правки метаданных — всё одним запросом. */
  async updateMetadata(
    userId: string,
    documentId: string,
    meta: { title: string; tags: string[]; labelId?: string | undefined; excludedFromAI?: boolean | undefined; lastSessionAt?: number | undefined; trashedAt?: number | null | undefined },
  ): Promise<void> {
    const encrypted = await maybeEncrypt({ title: meta.title, tags: meta.tags }, ['title'], ['tags'], userId);
    await DataProvider.updateDocument(userId, documentId, {
      ...encrypted,
      labelId: meta.labelId ?? null,
      excludedFromAI: meta.excludedFromAI === true,
      ...(meta.lastSessionAt !== undefined ? { lastSessionAt: meta.lastSessionAt } : {}),
      // N2-1: корзина, изменённая без связи, доезжает тем же досылом.
      ...(meta.trashedAt !== undefined ? { trashedAt: meta.trashedAt === null ? null : new Date(meta.trashedAt) } : {}),
    });
  },

  /**
   * S2-6: досыл только изменённых полей. «Последний по серверу» по полю
   * (владелец 02.11): поле, которое здесь не трогали, в облаке не перезаписывается
   * — иначе досыл тегов затирал корзину другого устройства (сид 88).
   * `fields` нет — флаг поставлен до 0.11.x, досылаются все поля (как раньше).
   */
  async updateMetadataFields(
    userId: string,
    documentId: string,
    meta: { title: string; tags: string[]; labelId?: string | undefined; excludedFromAI?: boolean | undefined; lastSessionAt?: number | undefined; trashedAt?: number | null | undefined },
    fields: readonly MetadataField[] | undefined,
  ): Promise<void> {
    if (!fields) return this.updateMetadata(userId, documentId, meta);
    const has = (f: MetadataField) => fields.includes(f);
    if (fields.length === 0) return;
    const sealed = await maybeEncrypt(
      { ...(has('title') ? { title: meta.title } : {}), ...(has('tags') ? { tags: meta.tags } : {}) },
      has('title') ? ['title'] : [], has('tags') ? ['tags'] : [], userId,
    );
    await DataProvider.updateDocument(userId, documentId, {
      ...sealed,
      ...(has('labelId') ? { labelId: meta.labelId ?? null } : {}),
      ...(has('excludedFromAI') ? { excludedFromAI: meta.excludedFromAI === true } : {}),
      ...(has('lastSessionAt') && meta.lastSessionAt !== undefined ? { lastSessionAt: meta.lastSessionAt } : {}),
      ...(has('trashedAt') ? { trashedAt: meta.trashedAt == null ? null : new Date(meta.trashedAt) } : {}),
    });
  },

  async updateLabelId(userId: string, documentId: string, labelId: string | undefined): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, { labelId: labelId ?? null });
  },

  async updateExcludedFromAI(userId: string, documentId: string, excludedFromAI: boolean): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, { excludedFromAI });
  },

  async trashDocument(userId: string, documentId: string, trashedAt: Date = new Date()): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, { trashedAt });
  },

  async restoreDocument(userId: string, documentId: string): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, { trashedAt: null });
  },

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    await DataProvider.deleteDocument(userId, documentId);
  },

  async clearLabelFromAllDocs(userId: string, labelId: string): Promise<void> {
    await DataProvider.clearLabelFromAllDocs(userId, labelId);
  },

  async renameTagInAllDocs(userId: string, oldTag: string, newTag: string): Promise<void> {
    await DataProvider.renameTagInAllDocs(userId, oldTag, newTag);
  },

  async removeTagFromAllDocs(userId: string, tag: string): Promise<void> {
    await DataProvider.removeTagFromAllDocs(userId, tag);
  },
};
