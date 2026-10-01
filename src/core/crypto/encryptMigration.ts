import { getSessionKey, encryptContent } from './encrypt';
import { maybeEncrypt, isKnownMoodEmoji } from './cryptoHelpers';
import { DataProvider } from '../data';
import { reportError } from '../../shared/errors/reportError';
import { getLocalDb } from '../storage/localDb';

// NARROW-4 / CHOKE-4: `core/` must not import from `features/` (ARCHITECTURE.md,
// enforced by import/no-restricted-paths).
//
// NOTE: This resolver INTENTIONALLY differs from `AISummaryService`'s inline search.
// They operate on completely different input domains:
// - `AISummaryService.saveSummaryToCloud` processes locally-created rows that may
//   lack canonical UUIDs, so it must check the local `documents` store.
// - `encryptMigration.ts` processes cloud-synced rows. Under Postgres RLS
//   (`0002_rls.sql`, `with check (... d.uuid = document_id ...)`), `document_id`
//   in cloud `ai_summaries`/`ai_embeddings` IS ALWAYS `documents.uuid` (already canonical).
//   Therefore, any non-`local_` documentId is trusted directly without a local DB lookup
//   (a cloud row may not even have a local copy on this device).
// DO NOT "unify" these two resolvers without accounting for the RLS invariant!
async function resolveCanonicalDocId(documentId: string, documentUuid?: string | undefined): Promise<string | null> {
  if (documentUuid) return documentUuid;
  // A row synced down from the cloud already carries the canonical id as
  // `documentId` — Postgres's `ai_summaries`/`ai_embeddings`.`document_id`
  // column IS `documents.uuid` (see the RLS policy quoted in
  // AIEmbeddingService.ts's resolveCanonicalId). Only a locally-created id
  // (prefixed `local_`) needs resolving through this device's own
  // `documents` store — a cloud-only row (no local copy on this device) has
  // no local entry to find, and doesn't need one.
  if (!documentId.startsWith('local_')) return documentId;
  const db = await getLocalDb();
  const doc = await db.get('documents', documentId);
  return doc?.uuid ?? null;
}

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

function isTombstoneOrRlsError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  const msg = typeof e === 'object' && e !== null && 'message' in e
    ? String((e as { message: unknown }).message)
    : (e instanceof Error ? e.message : String(e));
  return code === '42501' || /42501|row-level security policy/i.test(msg);
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
            const needsMoodEncryption = v._encrypted && typeof v.mood === 'string' && isKnownMoodEmoji(v.mood);
            if (checkpoint.has(ck) || (v._encrypted && !needsMoodEncryption)) {
              checkpoint.add(ck);
              progress.processed++;
              report();
              continue;
            }
            let clean: Record<string, unknown>;
            if (needsMoodEncryption) {
              const key = getSessionKey()!;
              const encMood = await encryptContent(v.mood as string, key);
              clean = { ...v, mood: encMood, _encrypted: true };
            } else {
              const encrypted = await maybeEncrypt(v as Record<string, unknown>, ['content', 'mood'], [], true);
              clean = Object.fromEntries(Object.entries(encrypted).filter(([, val]) => val !== undefined)) as Record<string, unknown>;
            }
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
        const encrypted = await maybeEncrypt(d.data as Record<string, unknown>, ['content', 'title'], ['pinnedThoughts', 'tags'], true);
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

  // AI Summaries
  try {
    const summaries = await DataProvider.getUserSummaries(userId);
    progress.total += summaries.length;
    report();

    for (const s of summaries) {
      if (signal?.aborted) throw new DOMException('Migration aborted', 'AbortError');
      if (!getSessionKey()) throw new VaultLockedError();

      const summaryDocId = (s.documentUuid || s.documentId || s.id) as string;
      const ck = `summary_${summaryDocId}`;
      // N4-2: до R3-4 хеш текста уходил открытым и у зашифрованных строк —
      // такие строки дошифровываем, не трогая остальные поля.
      const legacyPlainHash = s._encrypted === true && typeof s.contentHash === 'string' && /^[0-9a-f]{64}$/.test(s.contentHash);
      if (checkpoint.has(ck) || (s._encrypted && !legacyPlainHash)) {
        checkpoint.add(ck);
        progress.processed++;
        report();
        continue;
      }

      try {
        const canonicalId = await resolveCanonicalDocId((s.documentId || s.id || summaryDocId) as string, s.documentUuid as string | undefined);
        if (!canonicalId) {
          throw new Error(`NO_CANONICAL_ID:${s.documentId || s.id || summaryDocId}`);
        }
        let clean: Record<string, unknown>;
        if (legacyPlainHash) {
          const encHash = await encryptContent(s.contentHash as string, getSessionKey()!);
          clean = { ...s, documentUuid: canonicalId, contentHash: encHash };
        } else {
          // R3-4/N4-2: contentHash — в том же списке, что у AISummaryService.
          const STRING_FIELDS = ['summary', 'tone', 'echo', 'eventDate', 'quotableSentence', 'contentHash'];
          const ARRAY_FIELDS = ['frequentWords', 'authorPhrases', 'insights', 'themes', 'extractedFacts', 'commitments'];
          const encrypted = await maybeEncrypt({ ...s, documentUuid: canonicalId } as Record<string, unknown>, STRING_FIELDS, ARRAY_FIELDS, true);
          clean = Object.fromEntries(Object.entries(encrypted).filter(([, v]) => v !== undefined));
        }
        try {
          await DataProvider.saveSummary(userId, canonicalId, clean);
          checkpoint.add(ck);
          saveCheckpoint(userId, checkpoint);
          progress.encrypted++;
        } catch (saveErr) {
          if (isTombstoneOrRlsError(saveErr)) {
            // S-23: save refused under tombstone (0035 RLS 42501); 0035 allows DELETE.
            await DataProvider.deleteSummary(userId, canonicalId).catch(() => {});
            checkpoint.add(ck);
            saveCheckpoint(userId, checkpoint);
          } else {
            throw saveErr;
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        if (e instanceof VaultLockedError) throw e;
        progress.errors++;
        hadErrors = true;
        reportError(e, { action: 'encryptAllExistingNotes_summary', summaryDocId });
      }
      progress.processed++;
      report();
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    if (e instanceof VaultLockedError) throw e;
    hadErrors = true;
    reportError(e, { action: 'encryptAllExistingNotes_summariesQuery', userId });
  }

  // AI Embeddings
  try {
    const embeddings = await DataProvider.getUserEmbeddings(userId);
    progress.total += embeddings.length;
    report();

    for (const emb of embeddings) {
      if (signal?.aborted) throw new DOMException('Migration aborted', 'AbortError');
      if (!getSessionKey()) throw new VaultLockedError();

      const embDocId = (emb.documentUuid || emb.documentId || emb.id) as string;
      const ck = `emb_${embDocId}`;
      if (checkpoint.has(ck) || emb._encrypted) {
        checkpoint.add(ck);
        progress.processed++;
        report();
        continue;
      }

      try {
        const canonicalId = await resolveCanonicalDocId((emb.documentId || emb.id || embDocId) as string, emb.documentUuid as string | undefined);
        if (!canonicalId) {
          throw new Error(`NO_CANONICAL_ID:${emb.documentId || emb.id || embDocId}`);
        }
        const encrypted = await maybeEncrypt(
          { ...emb, documentUuid: canonicalId },
          ['vectorsJson', 'chunkTextsJson', 'model', 'contentHash'],
          [],
          true
        );
        const clean = Object.fromEntries(Object.entries(encrypted).filter(([, v]) => v !== undefined));
        try {
          await DataProvider.saveEmbedding(userId, canonicalId, clean);
          checkpoint.add(ck);
          saveCheckpoint(userId, checkpoint);
          progress.encrypted++;
        } catch (saveErr) {
          if (isTombstoneOrRlsError(saveErr)) {
            // S-23: save refused under tombstone (0035 RLS 42501); 0035 allows DELETE.
            await DataProvider.deleteEmbedding(userId, canonicalId).catch(() => {});
            checkpoint.add(ck);
            saveCheckpoint(userId, checkpoint);
          } else {
            throw saveErr;
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        if (e instanceof VaultLockedError) throw e;
        progress.errors++;
        hadErrors = true;
        reportError(e, { action: 'encryptAllExistingNotes_embedding', embDocId });
      }
      progress.processed++;
      report();
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    if (e instanceof VaultLockedError) throw e;
    hadErrors = true;
    reportError(e, { action: 'encryptAllExistingNotes_embeddingsQuery', userId });
  }

  // Local Store Records
  try {
    const storeRecords = await DataProvider.getLocalStoreRecords(userId);
    progress.total += storeRecords.length;
    report();

    for (const rec of storeRecords) {
      if (signal?.aborted) throw new DOMException('Migration aborted', 'AbortError');
      if (!getSessionKey()) throw new VaultLockedError();

      const ck = `ls_${rec.store}_${rec.key}`;
      const payload = rec.payload as Record<string, unknown> | undefined;
      if (checkpoint.has(ck) || payload?._encrypted) {
        checkpoint.add(ck);
        progress.processed++;
        report();
        continue;
      }

      try {
        const dataStr = typeof payload?.data === 'string' ? payload.data : JSON.stringify(payload ?? {});
        const encrypted = await maybeEncrypt(
          {
            data: dataStr,
            updatedAt: payload?.updatedAt ?? Date.now(),
          },
          ['data'],
          [],
          true
        );
        await DataProvider.saveLocalStoreRecord(userId, rec.store, rec.key, encrypted);
        checkpoint.add(ck);
        saveCheckpoint(userId, checkpoint);
        progress.encrypted++;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        if (e instanceof VaultLockedError) throw e;
        progress.errors++;
        hadErrors = true;
        reportError(e, { action: 'encryptAllExistingNotes_localStoreRecord', store: rec.store, key: rec.key });
      }
      progress.processed++;
      report();
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    if (e instanceof VaultLockedError) throw e;
    hadErrors = true;
    reportError(e, { action: 'encryptAllExistingNotes_localStoreRecordsQuery', userId });
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
        // R3-13: как в массовом пути — настроение версии тоже шифруется.
        const encrypted = await maybeEncrypt(v as Record<string, unknown>, ['content', 'mood'], [], true);
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
