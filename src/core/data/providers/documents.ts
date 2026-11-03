import { getSupabase } from '../../supabase/client';
import { ProviderRecord } from '../types';
import { maybeEncrypt, maybeDecrypt } from '../../crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import {
  DOCUMENT_FIELDS, DOCUMENT_REV, toDb, fromDb,
} from './fields';
import { pageAll, ownRows, ownRow } from './pageAll';

export async function createDocument(userId: string, data: ProviderRecord): Promise<string> {
  const docId = (data.uuid || data.id || crypto.randomUUID()) as string;
  const payload = toDb(DOCUMENT_FIELDS, { ...data, uuid: docId, userId });
  delete payload.id;
  const supabase = getSupabase();
  // R3-7: при 23505 на номере надгробия НЕ удаляем его и не вставляем заново —
  // это молча воскрешало заметку, удалённую на другом устройстве. Ошибка уходит
  // наверх, где ветка LIFE-10 (CloudSyncService) предупреждает человека.
  const { error } = await supabase
    .from('documents')
    .insert(payload);

  if (error != null) throw error;
  return docId;
}

export async function getDocument(userId: string, documentId: string): Promise<ProviderRecord | null> {
  const { data, error } = await getSupabase()
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .eq('uuid', documentId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error != null) throw error;
  if (!ownRow(data, userId)) return null;
  return fromDb(DOCUMENT_REV, data);
}

export async function getDocumentWithDeleted(userId: string, documentId: string): Promise<ProviderRecord | null> {
  const { data, error } = await getSupabase()
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .eq('uuid', documentId)
    .maybeSingle();
  if (error != null) throw error;
  if (!ownRow(data, userId)) return null;
  return fromDb(DOCUMENT_REV, data);
}

/**
 * S-47: какие из этих заметок в облаке сняты надгробием (`deleted_at` стоит).
 * Уборка облачных производных удаляет строку только по подтверждённому
 * надгробию: «нет в списке живых» — это и пустой ответ сервера, и обрезанная
 * страница, и заметка, созданная между двумя чтениями.
 */
export async function listTombstonedDocumentUuids(userId: string, uuids: string[]): Promise<string[]> {
  const out: string[] = [];
  // ponytail: пачками по 200 — фильтр `in` живёт в строке запроса, у неё есть предел длины.
  for (let i = 0; i < uuids.length; i += 200) {
    const { data, error } = await getSupabase()
      .from('documents')
      .select('uuid, user_id')
      .eq('user_id', userId)
      .in('uuid', uuids.slice(i, i + 200))
      .not('deleted_at', 'is', null);
    if (error != null) throw error;
    for (const row of ownRows((data ?? []) as Array<{ uuid: string | null; user_id: string }>, userId)) {
      if (row.uuid) out.push(row.uuid);
    }
  }
  return out;
}

/**
 * S1-6: строки заметок по uuid пачками — для версий, приехавших забором по
 * `rev` без строки документа. Надгробия обязательны: по ним решается
 * «отвязать»/«оставить», а не «нет строки — нет заметки».
 */
export async function getDocumentsByUuidsWithDeleted(userId: string, uuids: string[]): Promise<ProviderRecord[]> {
  const out: ProviderRecord[] = [];
  for (let i = 0; i < uuids.length; i += 200) {
    const { data, error } = await getSupabase()
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .in('uuid', uuids.slice(i, i + 200));
    if (error != null) throw error;
    for (const row of ownRows((data ?? []) as Record<string, unknown>[], userId)) {
      out.push(fromDb(DOCUMENT_REV, row));
    }
  }
  return out;
}

export async function getUserDocuments(userId: string): Promise<ProviderRecord[]> {
  const allRows = await pageAll((from, to) =>
    getSupabase()
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('uuid', { ascending: true })
      .range(from, to),
  );
  return ownRows(allRows, userId).map(row => fromDb(DOCUMENT_REV, row as Record<string, unknown>));
}

// Поля строки заметки, которые уходят в облако шифротекстом.
const SEALED_STRINGS = ['title', 'mood'];
const SEALED_ARRAYS = ['tags'];

/**
 * Единственная запись правки в строку заметки.
 *
 * Признак `_encrypted` у строки один на все поля, а правки частичные: теги
 * отдельно, заголовок отдельно, настроение отдельно. Правка с шифротекстом
 * имеет право лечь только на строку, которая уже зашифрована целиком. Иначе
 * получается строка-полукровка: например, теги зашифрованы и признак стоит, а
 * заголовок остался открытым — чтение пытается его расшифровать и падает («Не
 * удалось прочитать»), а миграция такую строку пропускает, потому что признак
 * уже стоит. То же в обратную сторону: шифротекст настроения под признаком
 * «не зашифровано».
 *
 * Поэтому правка с шифротекстом пишется с условием `_encrypted = true`. Если
 * она ни во что не попала, а строка есть и лежит открытым текстом (создана до
 * сейфа и не дошла до миграции), остальные её поля шифруются этим же запросом.
 * На обычной, уже зашифрованной строке это по-прежнему один запрос.
 */
/** Метка ряда из ответа на СОБСТВЕННУЮ запись (SF-7). `null` — ответа нет. */
function serverStampOf(rows: unknown): number | null {
  const first = Array.isArray(rows) ? rows[0] : rows;
  const raw = (first as Record<string, unknown> | null | undefined)?.updated_at;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Правка строки `documents`.
 *
 * SF-7: `returnStamp` — попросить сервер отдать `updated_at` принятой строки.
 * Просит тот, кто собирается запомнить «до какой облачной версии этот ряд
 * выгружен»: перечитывание ряда после записи ловит в этом окне чужую запись.
 * Без просьбы запрос остаётся ровно таким, каким был (лишние байты в ответе на
 * каждое сохранение метаданных не нужны).
 */
async function writeDocumentPatch(
  userId: string,
  documentId: string,
  payload: Record<string, unknown>,
  returnStamp = false,
): Promise<number | null> {
  const update = (patch: Record<string, unknown>) => getSupabase()
    .from('documents')
    .update(patch)
    .eq('user_id', userId)
    .eq('uuid', documentId)
    .is('deleted_at', null);

  if (payload._encrypted !== true) {
    if (!returnStamp) {
      const { error } = await update(payload);
      if (error != null) throw error;
      return null;
    }
    const { data, error } = await update(payload).select('updated_at');
    if (error != null) throw error;
    return serverStampOf(data);
  }

  const { data: touched, error } = await update(payload)
    .eq('_encrypted', true)
    .select(returnStamp ? 'uuid,updated_at' : 'uuid');
  if (error != null) throw error;
  if (touched != null && touched.length > 0) return serverStampOf(touched);

  const row = await getDocument(userId, documentId);
  // Строки нет или это надгробие: правка, как и раньше, ни во что не попадает.
  if (!row) return null;

  let patch = payload;
  if (row._encrypted !== true) {
    const rest: Record<string, unknown> = {};
    for (const f of [...SEALED_STRINGS, ...SEALED_ARRAYS]) {
      if (!(f in payload) && row[f] !== undefined) rest[f] = row[f];
    }
    // required = true: открытым текстом остаток не уйдёт ни при каком раскладе.
    patch = { ...toDb(DOCUMENT_FIELDS, await maybeEncrypt(rest, SEALED_STRINGS, SEALED_ARRAYS, true)), ...payload };
  }
  if (!returnStamp) {
    const { error: sealError } = await update(patch);
    if (sealError != null) throw sealError;
    return null;
  }
  const { data: sealed, error: sealError } = await update(patch).select('updated_at');
  if (sealError != null) throw sealError;
  return serverStampOf(sealed);
}

export async function updateDocument(userId: string, documentId: string, data: ProviderRecord): Promise<void> {
  const payload = toDb(DOCUMENT_FIELDS, data);
  delete payload.id;
  delete payload.uuid;
  delete payload.user_id;
  await writeDocumentPatch(userId, documentId, payload);
}

export async function updateDocumentSessionStats(
  userId: string,
  documentId: string,
  stats: {
    totalWords: number;
    durationDelta: number;
    currentVersion: number;
    mood?: string | null;
    /** `mood` — шифротекст; без этого признака он лёг бы на открытую строку. */
    moodEncrypted?: boolean;
    /**
     * R7Q-003: сколько сессий несёт ЭТА выгрузка. Абсолют из локальной копии не
     * шлётся никогда — им писатель со старой копией уносил облачный счётчик
     * назад. Нет поля — считаем один ход (обычное сохранение).
     */
    sessionsDelta?: number;
    lastSessionAt?: Date;
  }
): Promise<number | null> {
  const delta = Math.max(0, stats.sessionsDelta ?? 1);
  if (delta > 0) {
    // Атомарно в БД (0020): две вкладки или два устройства больше не
    // теряют инкременты из-за read-modify-write гонки.
    const { error: rpcError } = await getSupabase()
      .rpc('increment_document_sessions', { p_uuid: documentId, p_delta: delta });
    if (rpcError != null) throw rpcError;
  }

  // V-5 (0039): счётчики сессий складывает сервер. Раньше сюда клались
  // абсолюты, которые клиент прочитал из локальной копии, и писатель с устаревшей
  // копией тихо обнулял чужие приращения. Длительность — дельта этой выгрузки,
  // слова — максимум (в локальной модели это длина заметки, а не сумма).
  const { error: statsError } = await getSupabase()
    .rpc('sync_document_stats', {
      p_uuid: documentId,
      p_words: Math.max(0, Math.floor(stats.totalWords)),
      p_duration_delta: Math.floor(stats.durationDelta),
    });
  if (statsError != null) throw statsError;

  return updateDocumentSessionMeta(userId, documentId, stats);
}

/**
 * Поля строки после сессии — номер версии, время, настроение. Пишутся ПОСЛЕ
 * счётчиков: метка из ответа (SF-7) должна быть последней записью этого прогона,
 * иначе своя же прибавка выглядит «облако новее».
 */
export async function updateDocumentSessionMeta(
  userId: string,
  documentId: string,
  stats: { currentVersion: number; mood?: string | null; moodEncrypted?: boolean; lastSessionAt?: Date },
): Promise<number | null> {
  const updateData: Record<string, unknown> = {
    currentVersion: stats.currentVersion,
    lastSessionAt: stats.lastSessionAt !== undefined ? stats.lastSessionAt : new Date(),
  };
  if (stats.mood !== undefined) updateData.mood = stats.mood;
  if (stats.moodEncrypted === true) updateData._encrypted = true;

  const payload = toDb(DOCUMENT_FIELDS, updateData);
  delete payload.id;
  delete payload.uuid;
  delete payload.user_id;
  return writeDocumentPatch(userId, documentId, payload, true);
}

export async function deleteDocument(userId: string, documentId: string): Promise<void> {
  const supabase = getSupabase();
  // 1. Delete associated child records (versions, AI summaries, AI embeddings).
  // Ошибку проверяем на каждом: смысл надгробия в том, что содержимое стёрто,
  // а не спрятано. Молча провалившееся удаление версий оставило бы текст
  // заметки в облаке при документе, помеченном удалённым, — и следующий шаг
  // (RLS запрещает менять надгробие) сделал бы это необратимым.
  const versionsDel = await supabase
    .from('versions')
    .delete()
    .eq('user_id', userId)
    .eq('document_uuid', documentId);
  if (versionsDel.error != null) throw versionsDel.error;

  const summariesDel = await supabase
    .from('ai_summaries')
    .delete()
    .eq('user_id', userId)
    .eq('document_id', documentId);
  if (summariesDel.error != null) throw summariesDel.error;

  const embeddingsDel = await supabase
    .from('ai_embeddings')
    .delete()
    .eq('user_id', userId)
    .eq('document_id', documentId);
  if (embeddingsDel.error != null) throw embeddingsDel.error;

  // 2. Set tombstone on document row (zeroing metadata columns and setting deleted_at)
  const { error } = await supabase
    .from('documents')
    .update({
      deleted_at: new Date().toISOString(),
      title: '',
      tags: [],
      mood: null,
      label_id: null,
      is_public: false,
      _encrypted: false,
      total_words: 0,
      total_duration: 0,
      sessions_count: 0,
    })
    .eq('user_id', userId)
    .eq('uuid', documentId);
  if (error != null) throw error;
}

export async function clearLabelFromAllDocs(userId: string, labelId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('documents')
    .update({ label_id: null })
    .eq('user_id', userId)
    .eq('label_id', labelId)
    .is('deleted_at', null);
  if (error != null) throw error;
}

async function readAllDocTags(userId: string): Promise<{ uuid: string | null; tags: unknown; _encrypted: boolean | null; user_id: string }[]> {
  // N-45: владелец в выборке — чужие строки отбрасываются сразу, как у остальных читалок.
  return ownRows(await pageAll<{ uuid: string | null; tags: unknown; _encrypted: boolean | null; user_id: string }>((from, to) => getSupabase()
    .from('documents')
    .select('uuid, tags, _encrypted, user_id')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('uuid', { ascending: true })
    .range(from, to)), userId);
}

export async function renameTagInAllDocs(userId: string, oldTag: string, newTag: string): Promise<void> {
  // R4-7: постранично и с честной ошибкой — раньше обрывалось на 1000 заметках,
  // а сбой чтения молча считался успехом.
  const data = await readAllDocTags(userId);
  const failedUuids: string[] = [];

  for (const doc of data) {
    if (!doc.uuid) continue;
    let tags: string[] = [];
    try {
      const decrypted = await maybeDecrypt(
        { tags: doc.tags, _encrypted: doc._encrypted },
        [],
        ['tags']
      );
      tags = Array.isArray(decrypted.tags) ? (decrypted.tags as string[]) : [];
    } catch (e) {
      reportError(e, { action: 'renameTagInAllDocs_decrypt', docUuid: doc.uuid });
      continue;
    }

    if (tags.includes(oldTag)) {
      const newTags = Array.from(new Set(tags.map(t => (t === oldTag ? newTag : t))));
      const encrypted = await maybeEncrypt({ tags: newTags }, [], ['tags'], userId);
      try {
        await writeDocumentPatch(userId, doc.uuid, toDb(DOCUMENT_FIELDS, encrypted));
      } catch (updateError) {
        failedUuids.push(doc.uuid ?? '');
        reportError(updateError, { action: 'renameTagInAllDocs_update', docUuid: doc.uuid });
      }
    }
  }
  if (failedUuids.length > 0) {
    throw new Error(`TAG_OP_PARTIAL:${failedUuids.length}`);
  }
}

export async function removeTagFromAllDocs(userId: string, tag: string): Promise<void> {
  // R4-7: постранично и с честной ошибкой — раньше обрывалось на 1000 заметках,
  // а сбой чтения молча считался успехом.
  const data = await readAllDocTags(userId);
  const failedUuids: string[] = [];

  for (const doc of data) {
    if (!doc.uuid) continue;
    let tags: string[] = [];
    try {
      const decrypted = await maybeDecrypt(
        { tags: doc.tags, _encrypted: doc._encrypted },
        [],
        ['tags']
      );
      tags = Array.isArray(decrypted.tags) ? (decrypted.tags as string[]) : [];
    } catch (e) {
      reportError(e, { action: 'removeTagFromAllDocs_decrypt', docUuid: doc.uuid });
      continue;
    }

    if (tags.includes(tag)) {
      const newTags = tags.filter(t => t !== tag);
      const encrypted = await maybeEncrypt({ tags: newTags }, [], ['tags'], userId);
      // Ошибка per-doc апдейта — это не «успех»: проглоченный отказ RLS или
      // сети оставлял тег в облаке, и следующий синк воскрешал его в UI.
      try {
        await writeDocumentPatch(userId, doc.uuid, toDb(DOCUMENT_FIELDS, encrypted));
      } catch (updateError) {
        failedUuids.push(doc.uuid ?? '');
        reportError(updateError, { action: 'removeTagFromAllDocs_update', docUuid: doc.uuid });
      }
    }
  }
  if (failedUuids.length > 0) {
    throw new Error(`TAG_OP_PARTIAL:${failedUuids.length}`);
  }
}

/**
 * DEEP-11: Bulk reads across tables that grow per note (documents, versions, etc.)
 * MUST be paginated using .range() in batches of PAGE_SIZE (1000). PostgREST default
 * query limit is 1000 rows; unpaginated queries truncate silently and corrupt counts.
 */
export async function getCloudVersionDiscrepancyCount(userId: string): Promise<number> {
  const supabase = getSupabase();

  const fetchDocs = async () => {
    const rows = await pageAll((from, to) =>
      supabase
        .from('documents')
        .select('uuid, current_version, user_id')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('uuid', { ascending: true })
        .range(from, to),
    );
    return ownRows(rows, userId).map(row => ({
      uuid: (row as { uuid?: string }).uuid ?? '',
      current_version: (row as { current_version?: number }).current_version ?? 0,
    }));
  };

  const fetchVersionCounts = async () => {
    const counts = new Map<string, number>();
    const rows = await pageAll((from, to) =>
      supabase
        .from('versions')
        .select('document_uuid, user_id')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, to),
    );
    for (const row of ownRows(rows, userId)) {
      const id = (row as { document_uuid?: string }).document_uuid;
      if (id) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  };

  // R4-7: ошибка чтения — не «расхождений нет»; её видит диагностика.
  const [docs, versionCounts] = await Promise.all([fetchDocs(), fetchVersionCounts()]);
  let discrepancies = 0;
  for (const doc of docs) {
    const current = doc.current_version;
    const actual = versionCounts.get(doc.uuid) ?? 0;
    if (current !== actual && actual > 0) {
      discrepancies++;
    }
  }
  return discrepancies;
}
