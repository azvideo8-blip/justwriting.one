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
      const cloud = await fetchEmbeddingFromCloud(uid, documentId);
      if (cloud) {
        await db.put('aiEmbeddings', cloud);
        return cloud;
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
        console.error('[AIEmbeddingService] cloud save failed:', e);
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
