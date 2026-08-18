import { getSessionKey } from './encrypt';
import { maybeEncrypt } from './cryptoHelpers';
import { DataProvider } from '../data';

import { reportError } from '../../shared/errors/reportError';

export interface MigrationProgress {
  total: number;
  processed: number;
  encrypted: number;
  errors: number;
  /** Прервано дневным лимитом записей, а не доведено до конца. */
  incomplete?: boolean;
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
  type: 'version' | 'draft' | 'document';
  userId: string;
  documentId?: string;
  versionId?: string;
  draftId?: string;
  data: Record<string, unknown>;
  checkKey: string;
}

function makeFlush(pending: PendingOp[], onFlushed?: (keys: string[]) => void) {
  return async () => {
    if (pending.length === 0) return;
    const ops = pending.splice(0, pending.length);
    await flushPending(ops);
    onFlushed?.(ops.map(o => o.checkKey));
  };
}

async function flushPending(ops: PendingOp[]): Promise<void> {
  await DataProvider.executeMigrationBatch(ops);
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

  let hadErrors = false;

  // Documents & Versions
  try {
    const docs = await DataProvider.getUserDocuments(userId);
    progress.total += docs.length;
    report();

    for (const documentDoc of docs) {
      const documentId = (documentDoc.uuid || documentDoc.id) as string;
      const pending: PendingOp[] = [];
      const flush = makeFlush(pending, (keys) => {
        for (const k of keys) checkpoint.add(k);
        saveCheckpoint(userId, checkpoint);
      });

      // 1. Re-encrypt document metadata (title, tags, mood)
      const docCk = `doc_${documentId}`;
      if (checkpoint.has(docCk) || documentDoc._encrypted) {
        checkpoint.add(docCk);
        progress.processed++;
        report();
      } else {
        if (signal?.aborted) throw new DOMException('Migration aborted', 'AbortError');
        if (!getSessionKey()) throw new VaultLockedError();

        try {
          const encryptedDoc = await maybeEncrypt(
            documentDoc as Record<string, unknown>,
            ['title', 'mood'],
            ['tags'],
            true
          );
          const cleanDoc = Object.fromEntries(
            Object.entries(encryptedDoc).filter(([, v]) => v !== undefined)
          ) as Record<string, unknown>;
          pending.push({
            type: 'document',
            userId,
            documentId,
            data: cleanDoc,
            checkKey: docCk,
          });
          progress.encrypted++;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          progress.errors++;
          hadErrors = true;
          reportError(e, { action: 'encryptAllExistingNotes_document', documentId });
        }
        progress.processed++;
        report();
      }

      // 2. Re-encrypt versions
      try {
        const versions = await DataProvider.getVersions(userId, documentId);
        progress.total += versions.length;
        report();

        for (const v of versions) {
          if (signal?.aborted) throw new DOMException('Migration aborted', 'AbortError');
          if (!getSessionKey()) throw new VaultLockedError();

          try {
            const versionId = v.id as string;
            const ck = `v_${documentId}_${versionId}`;
            if (checkpoint.has(ck) || v._encrypted) {
              checkpoint.add(ck);
              progress.processed++;
              report();
              continue;
            }
            const encrypted = await maybeEncrypt(v as Record<string, unknown>, ['content'], [], true);
            const clean = Object.fromEntries(Object.entries(encrypted).filter(([, val]) => val !== undefined)) as Record<string, unknown>;
            pending.push({ type: 'version', userId, documentId, versionId, data: clean, checkKey: ck });
            if (pending.length >= BATCH_SIZE) await flush();
            progress.encrypted++;
          } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') throw e;
            progress.errors++;
            hadErrors = true;
            reportError(e, { action: 'encryptAllExistingNotes_version', versionId: String(v.id), documentId });
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
    const drafts = await DataProvider.getMigrationDrafts(userId);
    progress.total += drafts.length;
    report();

    const pending: PendingOp[] = [];
    const flush = makeFlush(pending, (keys) => {
      for (const k of keys) checkpoint.add(k);
      saveCheckpoint(userId, checkpoint);
    });

    for (const d of drafts) {
      if (signal?.aborted) throw new DOMException('Migration aborted', 'AbortError');
      if (!getSessionKey()) throw new VaultLockedError();

      try {
        const draftId = d.id as string;
        const ck = `d_${draftId}`;
        if (checkpoint.has(ck) || d.data._encrypted) {
          checkpoint.add(ck);
          progress.processed++;
          report();
          continue;
        }
        const encrypted = await maybeEncrypt(d.data as Record<string, unknown>, ['content'], ['pinnedThoughts'], true);
        const clean = Object.fromEntries(Object.entries(encrypted).filter(([, v]) => v !== undefined)) as Record<string, unknown>;
        pending.push({ type: 'draft', userId, draftId, data: clean, checkKey: ck });
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

  // Чекпойнт — память о проделанной работе. Снести его после завершения без ошибок.
  if (!hadErrors) clearCheckpoint(userId);
  return progress;
}

export async function encryptSingleDocument(
  userId: string,
  documentId: string,
): Promise<{ processed: number; encrypted: number; errors: number }> {
  const key = getSessionKey();
  if (!key) throw new Error('Not unlocked');

  const result = { processed: 0, encrypted: 0, errors: 0 };

  try {
    const pending: PendingOp[] = [];
    const flush = makeFlush(pending);

    // 1. Encrypt document row if needed
    const doc = await DataProvider.getDocument(userId, documentId);
    if (doc && !doc._encrypted) {
      try {
        const encryptedDoc = await maybeEncrypt(
          doc as Record<string, unknown>,
          ['title', 'mood'],
          ['tags'],
          true
        );
        const cleanDoc = Object.fromEntries(
          Object.entries(encryptedDoc).filter(([, val]) => val !== undefined)
        ) as Record<string, unknown>;
        pending.push({
          type: 'document',
          userId,
          documentId,
          data: cleanDoc,
          checkKey: `doc_${documentId}`,
        });
        result.encrypted++;
      } catch (e) {
        result.errors++;
        reportError(e, { action: 'encryptSingleDocument_doc', documentId });
      }
      result.processed++;
    }

    // 2. Encrypt versions
    const versions = await DataProvider.getVersions(userId, documentId);
    for (const v of versions) {
      if (!getSessionKey()) throw new VaultLockedError();
      try {
        const versionId = v.id as string;
        if (v._encrypted) {
          result.processed++;
          continue;
        }
        const encrypted = await maybeEncrypt(v as Record<string, unknown>, ['content'], [], true);
        const clean = Object.fromEntries(Object.entries(encrypted).filter(([, val]) => val !== undefined)) as Record<string, unknown>;
        pending.push({
          type: 'version', userId, documentId, versionId, data: clean, checkKey: `v_${documentId}_${versionId}`
        });
        if (pending.length >= BATCH_SIZE) await flush();
        result.encrypted++;
      } catch (e) {
        if (e instanceof VaultLockedError) throw e;
        result.errors++;
        reportError(e, { action: 'encryptSingleDocument_version', versionId: String(v.id), documentId });
      }
      result.processed++;
    }
    await flush();
  } catch (e) {
    reportError(e, { action: 'encryptSingleDocument_query', documentId });
    throw e;
  }

  return result;
}
