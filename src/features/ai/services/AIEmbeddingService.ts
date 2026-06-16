import { getLocalDb } from '../../../core/storage/localDb';
import type { AIDocumentEmbedding } from '../../../core/storage/localDb';
import { getAuth } from 'firebase/auth';
import { getClient } from '../../../core/firebase/firestoreClient';
import { maybeEncrypt, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';

const STRING_FIELDS = ['vectorJson', 'model', 'contentHash'] as const;
const ARRAY_FIELDS: string[] = [];
const STRING_FIELDS_LIST: string[] = [...STRING_FIELDS];

async function saveEmbeddingToCloud(userId: string, emb: AIDocumentEmbedding): Promise<void> {
  const payload = {
    documentId: emb.documentId,
    vectorJson: JSON.stringify(emb.vector),
    model: emb.model,
    dim: emb.dim,
    contentHash: emb.contentHash,
    processedAt: emb.processedAt,
  };
  const encrypted = await maybeEncrypt(payload, STRING_FIELDS_LIST, ARRAY_FIELDS, true);
  const { db, mod } = await getClient();
  await mod.setDoc(mod.doc(db, 'users', userId, 'embeddings', emb.documentId), encrypted, { merge: true });
}

async function fetchEmbeddingFromCloud(userId: string, documentId: string): Promise<AIDocumentEmbedding | undefined> {
  const { db, mod } = await getClient();
  const snap = await mod.getDoc(mod.doc(db, 'users', userId, 'embeddings', documentId));
  if (!snap.exists()) return undefined;
  const data = snap.data() as Record<string, unknown>;
  const decrypted = await maybeDecrypt(data, STRING_FIELDS_LIST, ARRAY_FIELDS);
  const docId = typeof decrypted.documentId === 'string' ? decrypted.documentId : documentId;
  const vectorJson = typeof decrypted.vectorJson === 'string' ? decrypted.vectorJson : '[]';
  let vector: number[];
  try {
    vector = JSON.parse(vectorJson);
  } catch {
    vector = [];
  }
  const model = typeof decrypted.model === 'string' ? decrypted.model : '';
  const dim = typeof decrypted.dim === 'number' ? decrypted.dim : vector.length;
  const contentHash = typeof decrypted.contentHash === 'string' ? decrypted.contentHash : '';
  const processedAt = typeof decrypted.processedAt === 'number' ? decrypted.processedAt : Date.now();
  return { documentId: docId, vector, model, dim, contentHash, processedAt };
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
        console.warn('[AIEmbeddingService] cloud read skipped:', e);
      }
    }
    return undefined;
  },

  async save(emb: AIDocumentEmbedding): Promise<void> {
    const db = await getLocalDb();
    await db.put('aiEmbeddings', emb);

    const uid = getAuth().currentUser?.uid;
    if (uid) {
      await saveEmbeddingToCloud(uid, emb).catch(e => {
        // ENCRYPT_REQUIRED = E2E locked (no session key). Expected for
        // background indexing while locked — the embedding is saved locally and
        // will sync on a later run when the key is available. Don't alarm.
        const msg = e instanceof Error ? e.message : String(e);
        // ENCRYPT_REQUIRED is expected when E2E is locked — stay silent.
        if (!msg.includes('ENCRYPT_REQUIRED')) {
          console.warn('[AIEmbeddingService] cloud save failed:', e);
        }
      });
    }
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
