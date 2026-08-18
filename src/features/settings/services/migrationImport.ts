import {
  getLocalDb,
  type LocalDocument,
  type LocalVersion,
  type LocalDraft,
  type AIDocumentSummary,
  type AIDocumentEmbedding,
} from "../../../core/storage/localDb";
import { invalidateMiniSearchCache } from "../../ai/utils/noteRetriever";
import { type MigrationManifest } from "./migrationExport";

export interface MigrationImportResult {
  success: boolean;
  imported: {
    documents: number;
    versions: number;
    drafts: number;
    aiSummaries: number;
    aiEmbeddings: number;
    verbatim: Record<string, number>;
  };
  skipped: {
    documents: number;
    versions: number;
    drafts: number;
    aiSummaries: number;
    aiEmbeddings: number;
    verbatim: Record<string, number>;
    details: { store: string; id: string; reason: string }[];
  };
  droppedOnPurpose: {
    peopleIndexRecords: number;
    summariesWithMentionedPeople: number;
    unknownStores: Record<string, number>;
  };
  error?: string;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function importMigrationManifest(
  rawManifest: unknown,
  targetUserId: string
): Promise<MigrationImportResult> {
  const imported: MigrationImportResult["imported"] = {
    documents: 0,
    versions: 0,
    drafts: 0,
    aiSummaries: 0,
    aiEmbeddings: 0,
    verbatim: {},
  };

  const skipped: MigrationImportResult["skipped"] = {
    documents: 0,
    versions: 0,
    drafts: 0,
    aiSummaries: 0,
    aiEmbeddings: 0,
    verbatim: {},
    details: [],
  };

  const droppedOnPurpose: MigrationImportResult["droppedOnPurpose"] = {
    peopleIndexRecords: 0,
    summariesWithMentionedPeople: 0,
    unknownStores: {},
  };

  if (!rawManifest || typeof rawManifest !== "object") {
    return {
      success: false,
      imported,
      skipped,
      droppedOnPurpose,
      error: "Invalid manifest: file is not a valid JSON object",
    };
  }

  const manifest = rawManifest as Partial<MigrationManifest>;

  if (manifest.version !== 1) {
    return {
      success: false,
      imported,
      skipped,
      droppedOnPurpose,
      error: `Unsupported manifest version: ${String(manifest.version)} (expected 1)`,
    };
  }

  const db = await getLocalDb();

  // Load existing state for idempotency and reference checks
  const existingDocs = (await db.getAll("documents")) as LocalDocument[];
  const existingDocsByUuid = new Map<string, LocalDocument>();
  const existingDocsById = new Map<string, LocalDocument>();
  for (const doc of existingDocs) {
    if (doc.uuid) existingDocsByUuid.set(doc.uuid, doc);
    existingDocsById.set(doc.id, doc);
  }

  const existingVers = (await db.getAll("versions")) as LocalVersion[];
  const existingVerIds = new Set(existingVers.map(v => v.id));

  const existingSummaries = (await db.getAll("aiSummaries")) as AIDocumentSummary[];
  const existingSummaryDocIds = new Set(existingSummaries.map(s => s.documentId));

  const existingEmbeddings = (await db.getAll("aiEmbeddings")) as AIDocumentEmbedding[];
  const existingEmbeddingDocIds = new Set(existingEmbeddings.map(e => e.documentId));

  const existingDrafts = (await db.getAll("drafts")) as LocalDraft[];
  const existingDraftUserIds = new Set(existingDrafts.map(d => d.userId));

  // Map manifest localId -> resolved DB document id
  const docIdMap = new Map<string, string>();

  // ── 1. Documents ────────────────────────────────────────────────────────
  const incomingDocs = Array.isArray(manifest.documents) ? manifest.documents : [];
  for (const doc of incomingDocs) {
    if (!doc.uuid) {
      skipped.documents++;
      skipped.details.push({
        store: "documents",
        id: doc.localId || "?",
        reason: "missing uuid",
      });
      continue;
    }

    if (existingDocsByUuid.has(doc.uuid)) {
      const existing = existingDocsByUuid.get(doc.uuid)!;
      docIdMap.set(doc.localId, existing.id);
      skipped.documents++;
      skipped.details.push({
        store: "documents",
        id: doc.localId,
        reason: `document already exists with uuid ${doc.uuid} as ${existing.id}`,
      });
      continue;
    }

    // ID collision: existing document has same localId but different uuid
    let targetId = doc.localId;
    if (existingDocsById.has(doc.localId)) {
      targetId = "local_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    }
    docIdMap.set(doc.localId, targetId);

    const localDoc: LocalDocument = {
      id: targetId,
      uuid: doc.uuid,
      guestId: targetUserId,
      title: doc.title ?? "",
      currentVersion: doc.currentVersion ?? 1,
      totalWords: doc.totalWords ?? 0,
      totalDuration: doc.totalDuration ?? 0,
      sessionsCount: doc.sessionsCount ?? 1,
      firstSessionAt: doc.firstSessionAt ?? Date.now(),
      lastSessionAt: doc.lastSessionAt ?? Date.now(),
      tags: doc.tags ?? [],
      labelId: doc.labelId,
      mood: doc.mood,
    };

    await db.put("documents", localDoc);
    existingDocsById.set(targetId, localDoc);
    existingDocsByUuid.set(doc.uuid, localDoc);
    imported.documents++;
  }

  // ── 2. Versions ─────────────────────────────────────────────────────────
  const checksums = manifest.checksums ?? {};
  for (const doc of incomingDocs) {
    const resolvedDocId = docIdMap.get(doc.localId);
    if (!resolvedDocId) {
      // Document was skipped due to missing uuid or other fatal error
      continue;
    }

    const versions = Array.isArray(doc.versions) ? doc.versions : [];
    for (const ver of versions) {
      const computedChecksum = await sha256Hex(ver.content ?? "");
      const expectedChecksum = checksums[ver.id];
      if (expectedChecksum && computedChecksum !== expectedChecksum) {
        skipped.versions++;
        skipped.details.push({
          store: "versions",
          id: ver.id,
          reason: `checksum mismatch: expected ${expectedChecksum}, computed ${computedChecksum}`,
        });
        continue;
      }

      if (existingVerIds.has(ver.id)) {
        skipped.versions++;
        skipped.details.push({
          store: "versions",
          id: ver.id,
          reason: "version already exists",
        });
        continue;
      }

      const localVer: LocalVersion = {
        id: ver.id,
        documentId: resolvedDocId,
        guestId: targetUserId,
        version: ver.version ?? 1,
        content: ver.content ?? "",
        wordCount: ver.wordCount ?? 0,
        wordsAdded: ver.wordsAdded ?? 0,
        charsAdded: ver.charsAdded ?? 0,
        duration: ver.duration ?? 0,
        wpm: ver.wpm ?? 0,
        goalWords: ver.goalWords,
        goalTime: ver.goalTime,
        goalReached: ver.goalReached,
        savedAt: ver.savedAt ?? Date.now(),
        sessionStartedAt: ver.sessionStartedAt ?? Date.now(),
        mood: ver.mood,
      };

      await db.put("versions", localVer);
      existingVerIds.add(ver.id);
      imported.versions++;
    }
  }

  // ── 3. AI Summaries ────────────────────────────────────────────────────
  const incomingSummaries = Array.isArray(manifest.aiSummaries) ? manifest.aiSummaries : [];
  for (const summary of incomingSummaries) {
    const targetDocId = docIdMap.get(summary.documentId);
    if (!targetDocId || !existingDocsById.has(targetDocId)) {
      skipped.aiSummaries++;
      skipped.details.push({
        store: "aiSummaries",
        id: summary.documentId,
        reason: "parent document does not exist or was skipped",
      });
      continue;
    }

    if (existingSummaryDocIds.has(targetDocId)) {
      skipped.aiSummaries++;
      skipped.details.push({
        store: "aiSummaries",
        id: targetDocId,
        reason: "summary already exists",
      });
      continue;
    }

    const { mentionedPeople, ...cleanSummary } = summary as AIDocumentSummary & {
      mentionedPeople?: unknown;
    };
    if (mentionedPeople !== undefined) {
      droppedOnPurpose.summariesWithMentionedPeople++;
    }
    cleanSummary.documentId = targetDocId;

    await db.put("aiSummaries", cleanSummary as AIDocumentSummary);
    existingSummaryDocIds.add(targetDocId);
    imported.aiSummaries++;
  }

  // ── 4. AI Embeddings ───────────────────────────────────────────────────
  const incomingEmbeddings = Array.isArray(manifest.aiEmbeddings) ? manifest.aiEmbeddings : [];
  for (const embedding of incomingEmbeddings) {
    const targetDocId = docIdMap.get(embedding.documentId);
    if (!targetDocId || !existingDocsById.has(targetDocId)) {
      skipped.aiEmbeddings++;
      skipped.details.push({
        store: "aiEmbeddings",
        id: embedding.documentId,
        reason: "parent document does not exist or was skipped",
      });
      continue;
    }

    if (existingEmbeddingDocIds.has(targetDocId)) {
      skipped.aiEmbeddings++;
      skipped.details.push({
        store: "aiEmbeddings",
        id: targetDocId,
        reason: "embedding already exists",
      });
      continue;
    }

    const cleanEmbedding = { ...embedding, documentId: targetDocId };
    await db.put("aiEmbeddings", cleanEmbedding);
    existingEmbeddingDocIds.add(targetDocId);
    imported.aiEmbeddings++;
  }

  // ── 5. Drafts ──────────────────────────────────────────────────────────
  const incomingDrafts = Array.isArray(manifest.drafts) ? manifest.drafts : [];
  for (const draft of incomingDrafts) {
    const targetDraftUserId = draft.userId || targetUserId;
    if (existingDraftUserIds.has(targetDraftUserId)) {
      skipped.drafts++;
      skipped.details.push({
        store: "drafts",
        id: targetDraftUserId,
        reason: "draft already exists",
      });
      continue;
    }

    await db.put("drafts", {
      userId: targetDraftUserId,
      title: draft.title ?? "",
      content: draft.content ?? "",
      seconds: 0,
      wpm: 0,
      wordCount: (draft.content ?? "").split(/\s+/).filter(Boolean).length,
      updatedAt: draft.updatedAt ?? Date.now(),
    });
    existingDraftUserIds.add(targetDraftUserId);
    imported.drafts++;
  }

  // ── 6. Verbatim stores ────────────────────────────────────────────────
  const incomingVerbatim = Array.isArray(manifest.verbatim) ? manifest.verbatim : [];
  for (const rec of incomingVerbatim) {
    if (rec.store === "aiPeopleIndex") {
      droppedOnPurpose.peopleIndexRecords++;
      continue;
    }

    if (rec.store === "syncQueue" || rec.store === "pending_sessions") {
      continue;
    }

    if (!db.objectStoreNames.contains(rec.store as never)) {
      droppedOnPurpose.unknownStores[rec.store] =
        (droppedOnPurpose.unknownStores[rec.store] || 0) + 1;
      continue;
    }

    if (rec.store === "aiTimeline") {
      const origDocId =
        (rec.payload as { documentId?: string })?.documentId ?? rec.key;
      const targetDocId = docIdMap.get(origDocId);
      if (!targetDocId || !existingDocsById.has(targetDocId)) {
        skipped.verbatim["aiTimeline"] =
          (skipped.verbatim["aiTimeline"] || 0) + 1;
        skipped.details.push({
          store: "aiTimeline",
          id: origDocId,
          reason: "parent document does not exist or was skipped",
        });
        continue;
      }

      const existingTimeline = await db.get("aiTimeline", targetDocId);
      if (existingTimeline !== undefined) {
        skipped.verbatim["aiTimeline"] =
          (skipped.verbatim["aiTimeline"] || 0) + 1;
        skipped.details.push({
          store: "aiTimeline",
          id: targetDocId,
          reason: "timeline record already exists",
        });
        continue;
      }

      const updatedPayload = {
        ...(rec.payload as Record<string, unknown>),
        documentId: targetDocId,
      };
      await db.put("aiTimeline", updatedPayload as never);
      imported.verbatim["aiTimeline"] =
        (imported.verbatim["aiTimeline"] || 0) + 1;
      continue;
    }

    if (rec.store === "aiDialogues") {
      let payload = rec.payload as Record<string, unknown>;
      if (
        payload?.documentId &&
        typeof payload.documentId === "string" &&
        docIdMap.has(payload.documentId)
      ) {
        payload = { ...payload, documentId: docIdMap.get(payload.documentId) };
      }

      const existing = await db.get("aiDialogues", rec.key);
      if (existing !== undefined) {
        skipped.verbatim["aiDialogues"] =
          (skipped.verbatim["aiDialogues"] || 0) + 1;
        skipped.details.push({
          store: "aiDialogues",
          id: rec.key,
          reason: "dialogue already exists",
        });
      } else {
        await db.put("aiDialogues", payload as never);
        imported.verbatim["aiDialogues"] =
          (imported.verbatim["aiDialogues"] || 0) + 1;
      }
      continue;
    }

    const existing = await db.get(rec.store as never, rec.key);
    if (existing !== undefined) {
      skipped.verbatim[rec.store] = (skipped.verbatim[rec.store] || 0) + 1;
      skipped.details.push({
        store: rec.store,
        id: rec.key,
        reason: `${rec.store} record already exists`,
      });
    } else {
      await db.put(rec.store as never, rec.payload);
      imported.verbatim[rec.store] = (imported.verbatim[rec.store] || 0) + 1;
    }
  }

  // ── 7. Cache Invalidation ─────────────────────────────────────────────
  invalidateMiniSearchCache();

  return {
    success: true,
    imported,
    skipped,
    droppedOnPurpose,
  };
}
