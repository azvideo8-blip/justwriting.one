import { getSessionKey } from './encrypt';
import { maybeEncrypt } from './cryptoHelpers';
import { getClient } from '../firebase/firestoreClient';
import type { DocumentReference, WriteBatch, FieldValue } from 'firebase/firestore';
import { reportError } from '../../shared/errors/reportError';

export interface MigrationProgress {
  total: number;
  processed: number;
  encrypted: number;
  errors: number;
}

const BATCH_SIZE = 400;

// V-2: thrown when the vault locks mid-migration; propagates through per-doc
// catch blocks to abort the run cleanly instead of erroring on every remaining doc.
class VaultLockedError extends Error {
  constructor() {
    super('Vault locked during migration');
    this.name = 'VaultLockedError';
  }
}

function getCheckpointKey(userId: string) {
  return `encryptionMigration_${userId}_checkpoint`;
}

function loadCheckpoint(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(getCheckpointKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.map(String));
    }
  } catch { /* ignore */ }
  return new Set();
}

function saveCheckpoint(userId: string, ids: Set<string>) {
  try {
    localStorage.setItem(getCheckpointKey(userId), JSON.stringify([...ids]));
  } catch (e) {
    reportError(e, { action: 'encryptMigration_checkpoint_save', processedCount: ids.size }, 'warning');
  }
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

function makeFlush(pending: PendingOp[], newBatch: () => WriteBatch, onFlushed?: (keys: string[]) => void) {
  return async () => {
    if (pending.length === 0) return;
    const keys = await flushPending(newBatch(), pending.splice(0, pending.length));
    onFlushed?.(keys);
  };
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

// [A-09] добавлен signal для отмены: предотвращает частичное шифрование при закрытии вкладки
const _migrationInProgress = new Set<string>();

export async function encryptAllExistingNotes(
  userId: string,
  onProgress?: (p: MigrationProgress) => void,
  signal?: AbortSignal,
): Promise<MigrationProgress> {
  if (_migrationInProgress.has(userId)) {
    throw new Error('Encryption migration already in progress for this user');
  }
  _migrationInProgress.add(userId);
  try {
    return await _encryptAllExistingNotesInner(userId, onProgress, signal);
  } finally {
    _migrationInProgress.delete(userId);
  }
}

async function _encryptAllExistingNotesInner(
  userId: string,
  onProgress?: (p: MigrationProgress) => void,
  signal?: AbortSignal,
): Promise<MigrationProgress> {
  if (signal?.aborted) throw new DOMException('Migration aborted', 'AbortError');
  const key = getSessionKey();
  if (!key) throw new Error('Not unlocked');

  const progress: MigrationProgress = { total: 0, processed: 0, encrypted: 0, errors: 0 };
  const report = () => onProgress?.({ ...progress });

  const checkpoint = loadCheckpoint(userId);

  const { db, mod } = await getClient();
  const { collection, getDocs, query, where, doc } = mod;

  let hadErrors = false;

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
        const flush = makeFlush(pending, () => mod.writeBatch(db), (keys) => {
          for (const k of keys) checkpoint.add(k);
          saveCheckpoint(userId, checkpoint);
        });

        for (const v of versionsSnap.docs) {
          if (signal?.aborted) throw new DOMException('Migration aborted', 'AbortError');
          // V-2: abort early if vault locked mid-run instead of erroring on every doc.
          if (!getSessionKey()) throw new VaultLockedError();
          try {
            const ck = `v_${documentId}_${v.id}`;
            if (checkpoint.has(ck) || v.data()._encrypted) {
              checkpoint.add(ck);
              progress.processed++;
              report();
              continue;
            }
            const encrypted = await maybeEncrypt(v.data() as Record<string, unknown>, ['content'], [], true);
            const clean = Object.fromEntries(Object.entries(encrypted).filter(([, v]) => v !== undefined));
            pending.push({ ref: doc(db, 'users', userId, 'documents', documentId, 'versions', v.id), data: clean, checkKey: ck });
            if (pending.length >= BATCH_SIZE) await flush();
             progress.encrypted++;
           } catch (e) {
             if (e instanceof DOMException && e.name === 'AbortError') throw e;
             progress.errors++;
             hadErrors = true;
             reportError(e, { action: 'encryptAllExistingNotes_version', versionId: v.id, documentId });
           }
          progress.processed++;
          report();
        }
         await flush();
       } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          if (e instanceof VaultLockedError) throw e;
          hadErrors = true;
          reportError(e, { action: 'encryptAllExistingNotes_documentVersions', documentId });
        }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    if (e instanceof VaultLockedError) throw e;
    hadErrors = true;
    reportError(e, { action: 'encryptAllExistingNotes_documentsQuery', userId });
  }

  // Drafts
  try {
    const draftSnap = await getDocs(query(collection(db, 'drafts'), where('userId', '==', userId)));
    progress.total += draftSnap.docs.length;
    report();

    const pending: PendingOp[] = [];
    const flush = makeFlush(pending, () => mod.writeBatch(db), (keys) => {
      for (const k of keys) checkpoint.add(k);
      saveCheckpoint(userId, checkpoint);
    });

    for (const d of draftSnap.docs) {
      if (signal?.aborted) throw new DOMException('Migration aborted', 'AbortError');
      // V-2: abort early if vault locked mid-run instead of erroring on every doc.
      if (!getSessionKey()) throw new VaultLockedError();
      try {
        const ck = `d_${d.id}`;
        if (checkpoint.has(ck) || d.data()._encrypted) {
          checkpoint.add(ck);
          progress.processed++;
          report();
          continue;
        }
        const encrypted = await maybeEncrypt(d.data() as Record<string, unknown>, ['content'], ['pinnedThoughts'], true);
        const clean = Object.fromEntries(Object.entries(encrypted).filter(([, v]) => v !== undefined));
        pending.push({ ref: doc(db, 'drafts', d.id), data: clean, checkKey: ck, useSet: true });
        if (pending.length >= BATCH_SIZE) await flush();
         progress.encrypted++;
       } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          if (e instanceof VaultLockedError) throw e;
          progress.errors++;
          hadErrors = true;
          reportError(e, { action: 'encryptAllExistingNotes_draft', draftId: d.id });
        }
      progress.processed++;
      report();
    }
    await flush();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    if (e instanceof VaultLockedError) throw e;
    hadErrors = true;
    reportError(e, { action: 'encryptAllExistingNotes_draftsQuery', userId });
  }

  if (!hadErrors) clearCheckpoint(userId);
  return progress;
}

export async function encryptSingleDocument(
  userId: string,
  documentId: string,
): Promise<{ processed: number; encrypted: number; errors: number }> {
  const key = getSessionKey();
  if (!key) throw new Error('Not unlocked');

  const { db, mod } = await getClient();
  const { collection, getDocs, doc } = mod;

  const result = { processed: 0, encrypted: 0, errors: 0 };

  try {
    const versionsSnap = await getDocs(collection(db, 'users', userId, 'documents', documentId, 'versions'));
    const pending: PendingOp[] = [];
    const flush = makeFlush(pending, () => mod.writeBatch(db));

    for (const v of versionsSnap.docs) {
      // V-2: abort early if vault locked mid-run instead of erroring on every doc.
      if (!getSessionKey()) throw new VaultLockedError();
      try {
        if (v.data()._encrypted) {
          result.processed++;
          continue;
        }
        const encrypted = await maybeEncrypt(v.data() as Record<string, unknown>, ['content'], [], true);
        const clean = Object.fromEntries(Object.entries(encrypted).filter(([, val]) => val !== undefined));
        pending.push({
          ref: doc(db, 'users', userId, 'documents', documentId, 'versions', v.id),
          data: clean,
          checkKey: `v_${documentId}_${v.id}`,
        });
        if (pending.length >= BATCH_SIZE) await flush();
        result.encrypted++;
      } catch (e) {
        if (e instanceof VaultLockedError) throw e;
        result.errors++;
        reportError(e, { action: 'encryptSingleDocument_version', versionId: v.id, documentId });
      }
      result.processed++;
    }
    await flush();
  } catch (e) {
    reportError(e, { action: 'encryptSingleDocument_versionsQuery', documentId });
    throw e;
  }

  return result;
}

