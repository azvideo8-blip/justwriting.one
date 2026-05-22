import { getSessionKey } from './encrypt';
import { maybeEncrypt } from './cryptoHelpers';
import { getClient } from '../firebase/firestoreClient';
import type { DocumentReference, WriteBatch, FieldValue } from 'firebase/firestore';

export interface MigrationProgress {
  total: number;
  processed: number;
  encrypted: number;
  errors: number;
}

const BATCH_SIZE = 400;

function getCheckpointKey(userId: string) {
  return `encryptionMigration_${userId}_checkpoint`;
}

function loadCheckpoint(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(getCheckpointKey(userId));
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

function saveCheckpoint(userId: string, ids: Set<string>) {
  try {
    localStorage.setItem(getCheckpointKey(userId), JSON.stringify([...ids]));
  } catch { /* ignore */ }
}

function clearCheckpoint(userId: string) {
  try {
    localStorage.removeItem(getCheckpointKey(userId));
  } catch { /* ignore */ }
}

interface PendingOp {
  ref: DocumentReference;
  data: Record<string, unknown>;
  checkKey: string;
  useSet?: boolean;
}

async function flushPending(batch: WriteBatch, ops: PendingOp[]): Promise<string[]> {
  const keys: string[] = [];
  for (const op of ops) {
    if (op.useSet) {
      batch.set(op.ref, op.data, { merge: true });
    } else {
      batch.update(op.ref, op.data as Record<string, FieldValue | Partial<unknown> | undefined>);
    }
    keys.push(op.checkKey);
  }
  await batch.commit();
  return keys;
}

export async function encryptAllExistingNotes(
  userId: string,
  onProgress?: (p: MigrationProgress) => void,
): Promise<MigrationProgress> {
  const key = getSessionKey();
  if (!key) throw new Error('Not unlocked');

  const progress: MigrationProgress = { total: 0, processed: 0, encrypted: 0, errors: 0 };
  const report = () => onProgress?.({ ...progress });

  const checkpoint = loadCheckpoint(userId);

  const { db, mod } = await getClient();
  const { collection, getDocs, query, where, doc } = mod;

  // Sessions
  try {
    const sessionsSnap = await getDocs(query(collection(db, 'sessions'), where('userId', '==', userId)));
    progress.total += sessionsSnap.docs.length;
    report();

    const pending: PendingOp[] = [];
    const flush = async () => {
      if (pending.length === 0) return;
      const keys = await flushPending(mod.writeBatch(db), pending.splice(0, pending.length));
      for (const k of keys) checkpoint.add(k);
      saveCheckpoint(userId, checkpoint);
    };

    for (const d of sessionsSnap.docs) {
      try {
        const ck = `s_${d.id}`;
        if (checkpoint.has(ck) || d.data()._encrypted) {
          checkpoint.add(ck);
          progress.processed++;
          report();
          continue;
        }
        const encrypted = await maybeEncrypt(d.data() as Record<string, unknown>, ['content'], ['pinnedThoughts', 'tags']);
        const clean = Object.fromEntries(Object.entries(encrypted).filter(([, v]) => v !== undefined));
        pending.push({ ref: doc(db, 'sessions', d.id), data: clean, checkKey: ck });
        if (pending.length >= BATCH_SIZE) await flush();
        progress.encrypted++;
      } catch (e) {
        progress.errors++;
        console.error(`encryptAll: session ${d.id} failed:`, e);
      }
      progress.processed++;
      report();
    }
    await flush();
  } catch (e) {
    console.error('encryptAll: sessions query failed:', e);
  }

  // Document versions
  try {
    const docsSnap = await getDocs(collection(db, 'users', userId, 'documents'));
    for (const documentDoc of docsSnap.docs) {
      const documentId = documentDoc.id;
      try {
        const versionsSnap = await getDocs(collection(db, 'users', userId, 'documents', documentId, 'versions'));
        progress.total += versionsSnap.docs.length;
        report();

        const pending: PendingOp[] = [];
        const flush = async () => {
          if (pending.length === 0) return;
          const keys = await flushPending(mod.writeBatch(db), pending.splice(0, pending.length));
          for (const k of keys) checkpoint.add(k);
          saveCheckpoint(userId, checkpoint);
        };

        for (const v of versionsSnap.docs) {
          try {
            const ck = `v_${documentId}_${v.id}`;
            if (checkpoint.has(ck) || v.data()._encrypted) {
              checkpoint.add(ck);
              progress.processed++;
              report();
              continue;
            }
            const encrypted = await maybeEncrypt(v.data() as Record<string, unknown>, ['content'], []);
            const clean = Object.fromEntries(Object.entries(encrypted).filter(([, v]) => v !== undefined));
            pending.push({ ref: doc(db, 'users', userId, 'documents', documentId, 'versions', v.id), data: clean, checkKey: ck });
            if (pending.length >= BATCH_SIZE) await flush();
            progress.encrypted++;
          } catch (e) {
            progress.errors++;
            console.error(`encryptAll: version ${v.id} failed:`, e);
          }
          progress.processed++;
          report();
        }
        await flush();
      } catch (e) {
        console.error(`encryptAll: document ${documentId} versions failed:`, e);
      }
    }
  } catch (e) {
    console.error('encryptAll: documents query failed:', e);
  }

  // Drafts
  try {
    const draftSnap = await getDocs(query(collection(db, 'drafts'), where('userId', '==', userId)));
    progress.total += draftSnap.docs.length;
    report();

    const pending: PendingOp[] = [];
    const flush = async () => {
      if (pending.length === 0) return;
      const keys = await flushPending(mod.writeBatch(db), pending.splice(0, pending.length));
      for (const k of keys) checkpoint.add(k);
      saveCheckpoint(userId, checkpoint);
    };

    for (const d of draftSnap.docs) {
      try {
        const ck = `d_${d.id}`;
        if (checkpoint.has(ck) || d.data()._encrypted) {
          checkpoint.add(ck);
          progress.processed++;
          report();
          continue;
        }
        const encrypted = await maybeEncrypt(d.data() as Record<string, unknown>, ['content'], ['pinnedThoughts']);
        const clean = Object.fromEntries(Object.entries(encrypted).filter(([, v]) => v !== undefined));
        pending.push({ ref: doc(db, 'drafts', d.id), data: clean, checkKey: ck, useSet: true });
        if (pending.length >= BATCH_SIZE) await flush();
        progress.encrypted++;
      } catch (e) {
        progress.errors++;
        console.error(`encryptAll: draft ${d.id} failed:`, e);
      }
      progress.processed++;
      report();
    }
    await flush();
  } catch (e) {
    console.error('encryptAll: drafts query failed:', e);
  }

  clearCheckpoint(userId);
  return progress;
}
