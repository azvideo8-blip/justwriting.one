import { getLocalDb } from '../../../core/storage/localDb';
import type { AIDocumentSummary, AIDocumentEmbedding, AITimelineEntry } from '../../../core/storage/localDb';
import { getClient } from '../../../core/firebase/firestoreClient';
import { sha256Hex, getLatestContent } from '../utils/embeddingIndexer';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { getEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { canSpendReadBudget, spendReadBudget, estimateReadUnits } from '../../../core/firebase/readBudget';
import { reportError } from '../../../shared/errors/reportError';
import { logger } from '../../../shared/errors/logger';
import { decodeCloudSummary } from './AISummaryService';
import { decodeCloudEmbedding } from './AIEmbeddingService';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';

const EMBED_RESTORE_FLAG = 'ai_embed_restore_requested';
const EMBED_RESTORE_CURSOR = 'ai_embed_restore_cursor';

/** Opt in to pulling the semantic index back from the cloud. Deliberately
 *  manual: the collection costs more read units than a whole free day. */
export function requestEmbeddingRestore(): void {
  try { localStorage.setItem(EMBED_RESTORE_FLAG, '1'); } catch { /* ignore */ }
}

export function isEmbeddingRestoreRequested(): boolean {
  try { return localStorage.getItem(EMBED_RESTORE_FLAG) === '1'; } catch { return false; }
}

function clearEmbeddingRestoreRequest(): void {
  try {
    localStorage.removeItem(EMBED_RESTORE_FLAG);
    localStorage.removeItem(EMBED_RESTORE_CURSOR);
  } catch { /* ignore */ }
}

/** Where the last run stopped, so a budget-limited restore resumes tomorrow
 *  instead of paying for the same pages again. */
function getEmbeddingRestoreCursor(): string {
  try { return localStorage.getItem(EMBED_RESTORE_CURSOR) ?? ''; } catch { return ''; }
}

function setEmbeddingRestoreCursor(id: string): void {
  try { localStorage.setItem(EMBED_RESTORE_CURSOR, id); } catch { /* ignore */ }
}

export interface AIRestoreResult {
  summaries: number;
  embeddings: number;
  /** Local records the cloud already holds, marked so they are not re-uploaded. */
  markedSynced: number;
  failed: number;
  skippedLocked: boolean;
}

/**
 * Pulls AI analysis back from the cloud into local storage.
 *
 * Signing out wipes every local store (SEC-29), which is correct on a shared
 * device but also deletes summaries and embeddings that cost real LLM calls to
 * produce. Both live in Firestore, so they never have to be recomputed — but
 * nothing walked those collections to bring them home, and the embedding
 * indexer deliberately never reads the cloud in its loop, so it would have
 * re-embedded every note from scratch instead.
 *
 * Read-only against the cloud, and it never overwrites a local record that is
 * already there: a restore must not clobber work newer than the cloud copy.
 */
export async function restoreAIDataFromCloud(userId: string): Promise<AIRestoreResult> {
  const result: AIRestoreResult = { summaries: 0, embeddings: 0, markedSynced: 0, failed: 0, skippedLocked: false };
  if (!userId) return result;

  // With E2E on but the vault locked, every decrypt throws. Restoring now would
  // just burn reads and log noise; the caller retries after unlock.
  if (getEncryptionEnabled(userId) && !getSessionKey()) {
    result.skippedLocked = true;
    return result;
  }

  const db = await getLocalDb();
  const { db: fs, mod } = await getClient();

  const existingSummaries = new Set((await db.getAllKeys('aiSummaries')).map(String));
  const existingEmbeddings = new Set((await db.getAllKeys('aiEmbeddings')).map(String));

  try {
    if (canSpendReadBudget()) {
      const snap = await mod.getDocs(mod.collection(fs, 'users', userId, 'summaries'));
      spendReadBudget(estimateReadUnits(snap.docs) || 1, 'AIRestoreService.restoreAIData_summaries');
      for (const d of snap.docs) {
        if (existingSummaries.has(d.id)) continue;
        try {
          await db.put('aiSummaries', await decodeCloudSummary(d.data() as Record<string, unknown>, d.id));
          result.summaries++;
        } catch {
          result.failed++;
        }
      }
    }
  } catch (e) {
    reportError(e, { action: 'restoreAIData_summaries', userId });
  }

  try {
    // Records already in the cloud must not be queued for upload. Anything
    // whose content hash the cloud already holds is present there under SOME
    // key — re-attach re-keys locally and the hash finds it again after a wipe,
    // so uploading it again buys nothing and costs a burst of multi-hundred-KB
    // vector writes. Missing this is how the daily write quota went twice in
    // one day.
    const localEmbeddings = await db.getAll('aiEmbeddings');
    const needsRepair = localEmbeddings.some(
      e => e.cloudSyncedAt === undefined && e.cloudSkipped !== true && Boolean(e.contentHash),
    );
    const cloudHashes = new Set<string>();

    // NOT part of the automatic pass. An embedding record carries its chunk
    // vectors — hundreds of KB, dozens of read units each — so walking this
    // collection costs more than the entire free daily read quota and locks the
    // user out of their own notes for the rest of the day. Embeddings are a
    // cache of a deterministic computation: the indexer rebuilds a missing one
    // locally, at its own daily pace, for zero Firestore reads. Restoring them
    // is a deliberate, user-initiated action (requestEmbeddingRestore) and
    // resumes across days from a stored cursor.
    if (isEmbeddingRestoreRequested() && canSpendReadBudget()) {
      const PAGE = 5;
      const docsPage: { id: string; data: () => unknown }[] = [];
      let cursor: unknown = undefined;
      const startAfterId = getEmbeddingRestoreCursor();
      for (;;) {
        const col = mod.collection(fs, 'users', userId, 'embeddings');
        const after = cursor ?? (startAfterId || undefined);
        const pageQuery = after
          ? mod.query(col, mod.orderBy('__name__'), mod.startAfter(after), mod.limit(PAGE))
          : mod.query(col, mod.orderBy('__name__'), mod.limit(PAGE));
        const pageSnap = await mod.getDocs(pageQuery);
        if (pageSnap.docs.length === 0) { clearEmbeddingRestoreRequest(); break; }
        spendReadBudget(estimateReadUnits(pageSnap.docs), 'AIRestoreService.restoreAIData_embeddings');
        docsPage.push(...pageSnap.docs);
        cursor = pageSnap.docs[pageSnap.docs.length - 1];
        setEmbeddingRestoreCursor(pageSnap.docs[pageSnap.docs.length - 1]!.id);
        if (pageSnap.docs.length < PAGE) { clearEmbeddingRestoreRequest(); break; }
        if (!canSpendReadBudget()) break;
      }
      const snap = { docs: docsPage };
      for (const d of snap.docs) {
        const alreadyLocal = existingEmbeddings.has(d.id);
        // Decoding an already-local record is pure CPU, no extra quota — worth it
        // only when there is something to repair.
        if (alreadyLocal && !needsRepair) continue;
        try {
          const decoded = await decodeCloudEmbedding(d.data() as Record<string, unknown>, d.id);
          if (decoded.contentHash) cloudHashes.add(decoded.contentHash);
          if (!alreadyLocal) {
            await db.put('aiEmbeddings', { ...decoded, cloudSyncedAt: Date.now() });
            result.embeddings++;
          }
        } catch {
          result.failed++;
        }
      }
    }

    if (needsRepair && cloudHashes.size > 0) {
      for (const e of await db.getAll('aiEmbeddings')) {
        if (e.cloudSyncedAt || e.cloudSkipped || !e.contentHash) continue;
        if (!cloudHashes.has(e.contentHash)) continue;
        await db.put('aiEmbeddings', { ...e, cloudSyncedAt: Date.now() });
        result.markedSynced++;
      }
    }
  } catch (e) {
    reportError(e, { action: 'restoreAIData_embeddings', userId });
  }

  if (result.summaries || result.embeddings || result.failed) {
    logger.info('AIRestoreService', 'Restored AI data from cloud', { ...result });
    useActivityLogStore.getState().addActivity(
      `Анализ восстановлен из облака (сводок: ${result.summaries}, эмбеддингов: ${result.embeddings})`,
      { action: 'restoreAIDataFromCloud', ...result },
      'info',
      'ai'
    );
  }
  return result;
}

export interface ReattachResult {
  summaries: number;
  embeddings: number;
}

/**
 * Re-keys restored analysis onto the notes it belongs to, matching on content hash.
 *
 * Analysis is keyed by the LOCAL document id (`local_<uuid>`), which is minted
 * per device. Downloading a note from the cloud mints a new one, and cloud
 * documents carry no record of the old id, so after a local wipe every restored
 * summary and embedding points at an id that will never exist again — present
 * in storage, attached to nothing.
 *
 * The content hash is the stable link: it is the same sha256 the indexer uses
 * for its freshness check, computed over the same latest-version text. Equal
 * hashes mean identical text, so adopting across a re-key cannot mis-attribute
 * analysis to a different note.
 */
export async function reattachOrphanedAnalysis(): Promise<ReattachResult> {
  const out: ReattachResult = { summaries: 0, embeddings: 0 };
  const db = await getLocalDb();

  const [docs, summaries, embeddings] = await Promise.all([
    db.getAll('documents'),
    db.getAll('aiSummaries'),
    db.getAll('aiEmbeddings'),
  ]);

  const docIds = new Set(docs.map(d => d.id));
  const orphanSummaries = new Map<string, AIDocumentSummary>();
  for (const s of summaries) {
    if (!docIds.has(s.documentId) && s.contentHash) orphanSummaries.set(s.contentHash, s);
  }
  const orphanEmbeddings = new Map<string, AIDocumentEmbedding>();
  for (const e of embeddings) {
    if (!docIds.has(e.documentId) && e.contentHash) orphanEmbeddings.set(e.contentHash, e);
  }
  if (orphanSummaries.size === 0 && orphanEmbeddings.size === 0) return out;

  const hasSummary = new Set(summaries.map(s => s.documentId));
  const hasEmbedding = new Set(embeddings.map(e => e.documentId));

  for (const doc of docs) {
    const needsSummary = !hasSummary.has(doc.id) && orphanSummaries.size > 0;
    const needsEmbedding = !hasEmbedding.has(doc.id) && orphanEmbeddings.size > 0;
    if (!needsSummary && !needsEmbedding) continue;

    const content = await getLatestContent(doc.id);
    if (!content) continue;
    const hash = await sha256Hex(content);

    if (needsSummary) {
      const orphan = orphanSummaries.get(hash);
      if (orphan) {
        const adopted: AIDocumentSummary = { ...orphan, documentId: doc.id };
        await db.put('aiSummaries', adopted);
        await db.delete('aiSummaries', orphan.documentId);
        // Claimed — two notes with identical text must not both take it.
        orphanSummaries.delete(hash);
        await rebuildTimelineEntry(db, doc, adopted);
        out.summaries++;
      }
    }

    if (needsEmbedding) {
      const orphan = orphanEmbeddings.get(hash);
      if (orphan) {
        await db.put('aiEmbeddings', { ...orphan, documentId: doc.id });
        await db.delete('aiEmbeddings', orphan.documentId);
        orphanEmbeddings.delete(hash);
        out.embeddings++;
      }
    }
  }

  if (out.summaries || out.embeddings) {
    logger.info('AIRestoreService', 'Re-attached orphaned analysis by content hash', { ...out });
    useActivityLogStore.getState().addActivity(
      `Анализ привязан к заметкам (сводок: ${out.summaries}, эмбеддингов: ${out.embeddings})`,
      { action: 'reattachOrphanedAnalysis', ...out },
      'info',
      'ai'
    );
  }
  return out;
}

/**
 * Rebuilds the timeline row that AISummaryService.save() would have written.
 * Deliberately does NOT call save(): that also triggers monthly digest
 * generation, which in a loop over every restored note is a digest storm.
 * The theme ledger is re-driven through its normal governed queue instead.
 */
async function rebuildTimelineEntry(
  db: Awaited<ReturnType<typeof getLocalDb>>,
  doc: { id: string; lastSessionAt?: number | undefined },
  summary: AIDocumentSummary,
): Promise<void> {
  if (!doc.lastSessionAt) return;
  const d = new Date(doc.lastSessionAt);
  if (isNaN(d.getTime())) return;
  const dateStr = d.toISOString().slice(0, 10);

  const entry: AITimelineEntry = {
    documentId: doc.id,
    date: dateStr,
    month: d.toISOString().slice(0, 7),
    facts: summary.extractedFacts ?? [],
    tone: summary.tone,
    themes: summary.themes ?? [],
    insights: summary.insights ?? [],
    eventDate: summary.eventDate ?? dateStr,
  };
  if (summary.summary !== undefined) entry.summary = summary.summary;
  if (summary.valence !== undefined) entry.valence = summary.valence;
  if (summary.arousal !== undefined) entry.arousal = summary.arousal;
  await db.put('aiTimeline', entry);

  if ((summary.themes?.length ?? 0) > 0) {
    try {
      const { enqueuePendingThemeTouch } = await import('./AIThemeLedgerService');
      enqueuePendingThemeTouch(doc.id);
    } catch (e) {
      reportError(e, { action: 'reattach_enqueueThemeTouch', documentId: doc.id });
    }
  }
}
