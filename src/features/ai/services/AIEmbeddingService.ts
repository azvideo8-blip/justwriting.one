import { getLocalDb } from '../../../core/storage/localDb';
import type { AIDocumentEmbedding } from '../../../core/storage/localDb';
import { getCurrentUser } from '../../../core/auth';
import { DataProvider } from '../../../core/data';
import { maybeEncrypt, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import { cloudSyncEnabled } from '../../../core/sync/cloudSyncEnabled';


// Gentle pacing between consecutive cloud writes in a bulk sync loop —
// this is a DAILY total quota, so pacing alone can't prevent exhausting it,
// but it avoids an instant burst of hundreds of writes in the same tick.
const SYNC_PACE_MS = 200;
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// Encrypt fields on save: only the chunked vectorsJson. Decrypt accepts the
// legacy single-vector vectorJson too, so old cloud docs still read.
const ENCRYPT_FIELDS = ['vectorsJson', 'chunkTextsJson', 'model', 'contentHash'];
const DECRYPT_FIELDS = ['vectorsJson', 'chunkTextsJson', 'vectorJson', 'model', 'contentHash'];
const ARRAY_FIELDS: string[] = [];

const MAX_CLOUD_EMBEDDING_BYTES = 1_000_000;

// Реестр свежести выгрузки (AUD-8). Запись эмбеддинга тянет сотни КБ векторов,
// поэтому «есть ли отстающие» нельзя выяснять полным чтением стора на каждый
// фоновый проход. Здесь держится только признак: documentId → 1, если запись
// уже синхронизирована или помечена как превышающая лимит. Обновляется во всех
// местах, где пишутся cloudSyncedAt/cloudSkipped; при отсутствии записи в
// реестре считается, что она не синхронизирована (безопасно: лишняя выгрузка
// вместо потери).
const CLOUD_FRESH_LS_KEY = 'ai_embedding_cloud_fresh_v1';

function loadFreshLedger(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CLOUD_FRESH_LS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, number>;
  } catch { /* ignore */ }
  return {};
}

function saveFreshLedger(ledger: Record<string, number>): void {
  try { localStorage.setItem(CLOUD_FRESH_LS_KEY, JSON.stringify(ledger)); } catch { /* намеренно: без отметки облако просто проверится ещё раз */ }
}

/** Помечает запись выгруженной (или пропущенной по размеру) в реестре. */
export function markCloudFresh(documentId: string): void {
  const ledger = loadFreshLedger();
  if (!ledger[documentId]) {
    ledger[documentId] = Date.now();
    saveFreshLedger(ledger);
  }
}

/** Снимает пометку: запись изменилась и снова подлежит выгрузке. */
export function markCloudStale(documentId: string): void {
  const ledger = loadFreshLedger();
  if (ledger[documentId] !== undefined) {
    delete ledger[documentId];
    saveFreshLedger(ledger);
  }
}

export function isOversizedError(msg: string): boolean {
  return /exceeds the maximum allowed size|exceeds.*1,?048,?576|invalid-argument.*size|document.*too large/i.test(msg);
}

/** RLS insert policy on ai_embeddings requires the parent document to already
 *  exist in the cloud. A local `documentUuid` doesn't guarantee that — it's
 *  set the moment the note is created locally, long before (or instead of)
 *  the document itself reaching the server. Same "not ready yet" case as the
 *  missing-uuid branch above, just caught after the request instead of
 *  before it. */
function isRlsDocumentNotReadyError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  const msg = e instanceof Error ? e.message : String(e);
  return code === '42501' || /row-level security policy/i.test(msg);
}

/**
 * The storage quota is measured in write UNITS, which scale with
 * document size — not in documents. At 4096 dimensions a full-precision float
 * serialises as ~20 characters ("-0.019052172876211"), so a multi-chunk note
 * produces a 400-900 KB document and roughly fifty of them exhaust the whole
 * day. Six decimals is far beyond what cosine similarity can distinguish on a
 * normalised vector and roughly halves the payload.
 */
function roundVectors(vectors: number[][]): number[][] {
  return vectors.map(chunk => chunk.map(v => Math.round(v * 1e6) / 1e6));
}

export async function saveEmbeddingToCloud(userId: string, emb: AIDocumentEmbedding): Promise<{ skipped: boolean }> {
  const canonicalId = await resolveCanonicalId(emb);
  if (!canonicalId) {
    // За вектором не стоит заметки: под локальным номером база строку не
    // примет, и отправлять её бессмысленно. Отказ громкий, чтобы проход
    // выгрузки не отчитался успехом за строку, которой в облаке не появилось.
    throw new Error(`NO_CANONICAL_ID:${emb.documentId}`);
  }

  let payload: Record<string, unknown> = {
    documentId: emb.documentId,
    documentUuid: canonicalId,
    vectorsJson: JSON.stringify(roundVectors(emb.vectors)),
    chunkTextsJson: JSON.stringify(emb.chunkTexts ?? []),
    model: emb.model,
    dim: emb.dim,
    contentHash: emb.contentHash,
    processedAt: emb.processedAt,
    schemaV: emb.schemaV ?? null,
  };
  let encrypted = await maybeEncrypt(payload, ENCRYPT_FIELDS, ARRAY_FIELDS, userId);
  let size = new TextEncoder().encode(JSON.stringify(encrypted)).length;

  if (size > MAX_CLOUD_EMBEDDING_BYTES && emb.chunkTexts && emb.chunkTexts.length > 0) {
    payload = {
      ...payload,
      chunkTextsJson: JSON.stringify([]),
    };
    encrypted = await maybeEncrypt(payload, ENCRYPT_FIELDS, ARRAY_FIELDS, userId);
    size = new TextEncoder().encode(JSON.stringify(encrypted)).length;
  }

  if (size > MAX_CLOUD_EMBEDDING_BYTES) {
    return { skipped: true };
  }

  await DataProvider.saveEmbedding(userId, canonicalId, encrypted);
  return { skipped: false };
}

/**
 * Канонический номер заметки для строки в облаке.
 *
 * Политика RLS требует
 *   exists (select 1 from documents d where d.uuid = document_id and ...)
 * поэтому `local_…` её не проходит: Postgres отвечает 403 «new row violates
 * row-level security policy».
 *
 * Резолвинг живёт ЗДЕСЬ, в единственной точке выгрузки, а не у вызывающих.
 * В 0.8.22 он был расставлен по вызывающим — и `save`, и `syncPendingToCloud`
 * подставляли uuid сами, — а третий путь, `AIDerivedDataSyncService`,
 * читает строки из хранилища как есть и про эту договорённость не знал: 114
 * векторов отбились по политике на первом же ручном проходе выгрузки.
 * Одно правило — одна реализация, в той функции, через которую идут все.
 */
export async function resolveCanonicalId(emb: { documentId: string; documentUuid?: string | undefined }): Promise<string | null> {
  if (emb.documentUuid) return emb.documentUuid;
  const db = await getLocalDb();
  const doc = await db.get('documents', emb.documentId);
  if (!doc?.uuid) return null;
  // Найденное запоминается: следующий проход не ищет заново.
  try {
    const existing = await db.get('aiEmbeddings', emb.documentId);
    if (existing) {
      await db.put('aiEmbeddings', { ...existing, documentUuid: doc.uuid });
    }
  } catch { /* ignore */ }
  return doc.uuid;
}

function parseVectors(decrypted: Record<string, unknown>): number[][] {
  // New chunked format.
  if (typeof decrypted.vectorsJson === 'string') {
    try {
      const v = JSON.parse(decrypted.vectorsJson);
      if (Array.isArray(v) && Array.isArray(v[0])) return v as number[][];
      if (Array.isArray(v)) return [v as number[]];
    } catch { /* fall through */ }
  }
  // Legacy single-vector format.
  if (typeof decrypted.vectorJson === 'string') {
    try {
      const v = JSON.parse(decrypted.vectorJson);
      if (Array.isArray(v)) return [v as number[]];
    } catch { /* fall through */ }
  }
  return [];
}

/**
 * Decodes one cloud embedding payload. Exported so the bulk restore decodes
 * with exactly this logic — including the legacy single-vector format — rather
 * than growing a second parser that drifts from it.
 */
export async function decodeCloudEmbedding(
  data: Record<string, unknown>,
  documentId: string,
): Promise<AIDocumentEmbedding> {
  const decrypted = await maybeDecrypt(data, DECRYPT_FIELDS, ARRAY_FIELDS);
  const docId = typeof decrypted.documentId === 'string' ? decrypted.documentId : documentId;
  const vectors = parseVectors(decrypted);
  const model = typeof decrypted.model === 'string' ? decrypted.model : '';
  const dim = typeof decrypted.dim === 'number' ? decrypted.dim : (vectors[0]?.length ?? 0);
  const contentHash = typeof decrypted.contentHash === 'string' ? decrypted.contentHash : '';
  const processedAt = typeof decrypted.processedAt === 'number' ? decrypted.processedAt : 0;
  const base: AIDocumentEmbedding = { documentId: docId, vectors, model, dim, contentHash, processedAt };
  // Замыкает круг: восстановленный эмбеддинг знает каноничный id своей заметки.
  if (typeof decrypted.documentUuid === 'string') base.documentUuid = decrypted.documentUuid;
  if (typeof decrypted.schemaV === 'number') base.schemaV = decrypted.schemaV;
  if (typeof decrypted.chunkTextsJson === 'string') {
    try {
      const ct = JSON.parse(decrypted.chunkTextsJson);
      if (Array.isArray(ct) && ct.length) base.chunkTexts = ct.map(String);
    } catch { /* ignore */ }
  }
  return base;
}

async function fetchEmbeddingFromCloud(userId: string, documentId: string): Promise<AIDocumentEmbedding | undefined> {
  const data = await DataProvider.getEmbedding(userId, documentId);
  if (!data) return undefined;
  return decodeCloudEmbedding(data as Record<string, unknown>, documentId);
}

export const AIEmbeddingService = {
  async get(documentId: string): Promise<AIDocumentEmbedding | undefined> {
    const db = await getLocalDb();
    const local = await db.get('aiEmbeddings', documentId);
    if (local) return local;

    const uid = getCurrentUser()?.uid;
    if (uid) {
      // Cloud is best-effort: a read can throw on permissions, offline, or a
      // LOCKED decrypt (E2E session key absent). Never let that break callers —
      // fall back to "not found" and rely on the local store / re-indexing.
      try {
        const cloud = await fetchEmbeddingFromCloud(uid, documentId);
        if (cloud) {
          await db.put('aiEmbeddings', cloud);
          return cloud;
        }
      } catch (e) {
        reportError(e, { action: 'ai_embedding_cloud_read' });
      }
    }
    return undefined;
  },

  async save(emb: AIDocumentEmbedding): Promise<void> {
    const db = await getLocalDb();
    // Populate documentUuid from the document for future reattach by uuid.
    const doc = await db.get('documents', emb.documentId);
    const withUuid = doc?.uuid ? { ...emb, documentUuid: doc.uuid } : emb;
    await db.put('aiEmbeddings', withUuid);
    // Запись обновилась — старая пометка выгрузки больше не действует.
    markCloudStale(emb.documentId);

    const uid = getCurrentUser()?.uid;
    // SEC-8: Background write-time upload respects cloudSyncEnabled switch
    if (uid && cloudSyncEnabled(uid)) {
      try {
        // withUuid везде, а не emb: иначе запись обратно затирает documentUuid,
        // проставленный строкой выше, и привязка по каноничному id теряется
        // ровно тогда, когда выгрузка удалась.
        const { skipped } = await saveEmbeddingToCloud(uid, withUuid);
        if (skipped) {
          await db.put('aiEmbeddings', { ...withUuid, cloudSkipped: true });
          markCloudFresh(withUuid.documentId);
        } else {
          await db.put('aiEmbeddings', { ...withUuid, cloudSyncedAt: Date.now() });
          markCloudFresh(withUuid.documentId);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isOversizedError(msg)) {
          await db.put('aiEmbeddings', { ...withUuid, cloudSkipped: true });
          markCloudFresh(withUuid.documentId);
        } else if (isRlsDocumentNotReadyError(e)) {
          // Документ ещё не долетел до облака — запись остаётся pending без
          // отметки и без лога, syncPendingToCloud подхватит её позже.
        } else if (!msg.includes('ENCRYPT_REQUIRED')) {
          reportError(e, { action: 'ai_embedding_cloud_save' });
        }
      }
    }
  },

  /** Uploads local embeddings not yet in the cloud (e.g. saved while E2E was
   *  locked, or left behind after an embedding-model change marked everything
   *  stale). Makes NO AI calls; uploads are paced sequentially with SYNC_PACE_MS.
   *  Stops early if E2E is locked; the rest retry on a later pass. */
  async syncPendingToCloud(): Promise<{ synced: number; pending: number; locked: boolean }> {
    const uid = getCurrentUser()?.uid;
    const db = await getLocalDb();
    // Полный getAll здесь десериализовал векторы и чанк-тексты ВСЕХ заметок
    // на каждый фоновый проход ради пары отставших. Свежесть берём из
    // реестра (AUD-8), целиком читаем только отстающие записи.
    const ledger = loadFreshLedger();
    const keys = await db.getAllKeys('aiEmbeddings');
    const pending: AIDocumentEmbedding[] = [];
    for (const key of keys) {
      if (ledger[String(key)]) continue;
      const meta = await db.get('aiEmbeddings', key);
      if (meta && !meta.cloudSyncedAt && !meta.cloudSkipped) {
        pending.push(meta);
      }
    }
    if (!uid || pending.length === 0) return { synced: 0, pending: pending.length, locked: false };


    let synced = 0;
    for (let i = 0; i < pending.length; i++) {
      const emb = pending[i]!;

      // save() подставляет documentUuid при записи, а этот путь — повторная
      // выгрузка отставших — раньше брал запись из хранилища как есть. У записей,
      // сохранённых до появления этого поля, uuid нет, выгрузка отлетает по RLS,
      // запись остаётся pending и повторяется КАЖДЫЙ фоновый проход. Отсюда и
      // поток одинаковых ошибок в журнале.
      let ready = emb;
      if (!ready.documentUuid) {
        const doc = await db.get('documents', emb.documentId);
        if (doc?.uuid) {
          ready = { ...emb, documentUuid: doc.uuid };
          // Сохраняем, чтобы не разрешать заново на каждом проходе.
          await db.put('aiEmbeddings', ready);
        } else {
          // Документа с каноническим id пока нет — выгружать нечего: RLS всё
          // равно откажет. Пропускаем ПОПЫТКУ, но запись НЕ помечаем.
          //
          // Помечать нельзя: при восстановлении из облака данные ИИ могут
          // приехать раньше самих заметок, и запись, похороненная как
          // «пропущенная», не выгрузилась бы уже никогда. Так она просто ждёт
          // документа — без запроса в сеть и без строки в журнале, то есть без
          // того спама, ради которого всё и чинится.
          continue;
        }
      }

      try {
        const { skipped } = await saveEmbeddingToCloud(uid, ready);
        if (skipped) {
          await db.put('aiEmbeddings', { ...ready, cloudSkipped: true });
          markCloudFresh(ready.documentId);
        } else {
          await db.put('aiEmbeddings', { ...ready, cloudSyncedAt: Date.now() });
          markCloudFresh(ready.documentId);
          synced++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isOversizedError(msg)) {
          await db.put('aiEmbeddings', { ...emb, cloudSkipped: true });
          markCloudFresh(emb.documentId);
        } else if (msg.includes('ENCRYPT_REQUIRED')) {
          return { synced, pending: pending.length, locked: true };
        } else if (isRlsDocumentNotReadyError(e)) {
          // Тот же случай, что и пропуск выше по отсутствию documentUuid —
          // просто пойман после запроса, а не до: сервер ещё не видит
          // документ. Не логируем и не помечаем — само перестанет повторяться,
          // как только сам документ долетит до облака.
          continue;
        } else {
          reportError(e, { action: 'ai_embedding_cloud_sync', docId: emb.documentId });
        }
      }
      if (i < pending.length - 1) await sleep(SYNC_PACE_MS);
    }
    return { synced, pending: pending.length, locked: false };
  },

  async getAll(): Promise<AIDocumentEmbedding[]> {
    const db = await getLocalDb();
    return db.getAll('aiEmbeddings');
  },

  async hasAll(): Promise<Record<string, boolean>> {
    const db = await getLocalDb();
    const all = await db.getAll('aiEmbeddings');
    const map: Record<string, boolean> = {};
    for (const e of all) {
      map[e.documentId] = true;
    }
    return map;
  },

  async delete(documentId: string): Promise<void> {
    const db = await getLocalDb();
    await db.delete('aiEmbeddings', documentId);
    markCloudStale(documentId);
  },
};
