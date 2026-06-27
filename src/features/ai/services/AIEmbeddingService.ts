import { getLocalDb } from '../../../core/storage/localDb';
import type { AIDocumentEmbedding } from '../../../core/storage/localDb';
import { getAuth } from 'firebase/auth';
import { getClient } from '../../../core/firebase/firestoreClient';
import { maybeEncrypt, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';

// Encrypt fields on save: only the chunked vectorsJson. Decrypt accepts the
// legacy single-vector vectorJson too, so old cloud docs still read.
const ENCRYPT_FIELDS = ['vectorsJson', 'chunkTextsJson', 'model', 'contentHash'];
const DECRYPT_FIELDS = ['vectorsJson', 'chunkTextsJson', 'vectorJson', 'model', 'contentHash'];
const ARRAY_FIELDS: string[] = [];

async function saveEmbeddingToCloud(userId: string, emb: AIDocumentEmbedding): Promise<void> {
  const payload = {
    documentId: emb.documentId,
    vectorsJson: JSON.stringify(emb.vectors),
    chunkTextsJson: JSON.stringify(emb.chunkTexts ?? []),
    model: emb.model,
    dim: emb.dim,
    contentHash: emb.contentHash,
    processedAt: emb.processedAt,
    schemaV: emb.schemaV ?? null,
  };
  const encrypted = await maybeEncrypt(payload, ENCRYPT_FIELDS, ARRAY_FIELDS, true);
  const { db, mod } = await getClient();
  await mod.setDoc(mod.doc(db, 'users', userId, 'embeddings', emb.documentId), encrypted, { merge: true });
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

async function fetchEmbeddingFromCloud(userId: string, documentId: string): Promise<AIDocumentEmbedding | undefined> {
  const { db, mod } = await getClient();
  const snap = await mod.getDoc(mod.doc(db, 'users', userId, 'embeddings', documentId));
  if (!snap.exists()) return undefined;
  const data = snap.data() as Record<string, unknown>;
  const decrypted = await maybeDecrypt(data, DECRYPT_FIELDS, ARRAY_FIELDS);
  const docId = typeof decrypted.documentId === 'string' ? decrypted.documentId : documentId;
  const vectors = parseVectors(decrypted);
  const model = typeof decrypted.model === 'string' ? decrypted.model : '';
  const dim = typeof decrypted.dim === 'number' ? decrypted.dim : (vectors[0]?.length ?? 0);
  const contentHash = typeof decrypted.contentHash === 'string' ? decrypted.contentHash : '';
  const processedAt = typeof decrypted.processedAt === 'number' ? decrypted.processedAt : Date.now();
  const base: AIDocumentEmbedding = { documentId: docId, vectors, model, dim, contentHash, processedAt };
  if (typeof decrypted.schemaV === 'number') base.schemaV = decrypted.schemaV;
  if (typeof decrypted.chunkTextsJson === 'string') {
    try {
      const ct = JSON.parse(decrypted.chunkTextsJson);
      if (Array.isArray(ct) && ct.length) base.chunkTexts = ct.map(String);
    } catch { /* ignore */ }
  }
  return base;
}

export const AIEmbeddingService = {
  async get(documentId: string): Promise<AIDocumentEmbedding | undefined> {
    const db = await getLocalDb();
    const local = await db.get('aiEmbeddings', documentId);
    if (local) return local;

    const uid = getAuth().currentUser?.uid;
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
    await db.put('aiEmbeddings', emb);

    const uid = getAuth().currentUser?.uid;
    if (uid) {
      try {
        await saveEmbeddingToCloud(uid, emb);
        await db.put('aiEmbeddings', { ...emb, cloudSyncedAt: Date.now() });
      } catch (e) {
        // ENCRYPT_REQUIRED = E2E locked (no session key). Expected for background
        // indexing while locked — the embedding stays local (cloudSyncedAt unset)
        // and a later syncPendingToCloud() pass uploads it. Don't alarm.
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes('ENCRYPT_REQUIRED')) {
          reportError(e, { action: 'ai_embedding_cloud_save' });
        }
      }
    }
  },

  /** Uploads local embeddings not yet in the cloud (e.g. saved while E2E was
   *  locked). Makes NO AI calls — pure Firestore writes, so no quota/rate cost.
   *  Stops early if E2E is locked; the rest retry on a later pass. */
  async syncPendingToCloud(): Promise<{ synced: number; pending: number; locked: boolean }> {
    const uid = getAuth().currentUser?.uid;
    const db = await getLocalDb();
    const all = await db.getAll('aiEmbeddings');
    const pending = all.filter(e => !e.cloudSyncedAt);
    if (!uid || pending.length === 0) return { synced: 0, pending: pending.length, locked: false };

    let synced = 0;
    for (const emb of pending) {
      try {
        await saveEmbeddingToCloud(uid, emb);
        await db.put('aiEmbeddings', { ...emb, cloudSyncedAt: Date.now() });
        synced++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('ENCRYPT_REQUIRED')) {
          return { synced, pending: pending.length, locked: true };
        }
        reportError(e, { action: 'ai_embedding_cloud_sync', docId: emb.documentId });
      }
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
  },
};
