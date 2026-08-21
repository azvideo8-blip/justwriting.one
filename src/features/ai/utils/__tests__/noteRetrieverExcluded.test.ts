import { describe, it, expect, vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { searchNotes, searchNotesMulti, invalidateMiniSearchCache } from "../noteRetriever";
import { findRelatedNotes } from "../relatedNotes";
import { AIService } from "../../services/AIService";
import { AIEmbeddingService } from "../../services/AIEmbeddingService";
import { getLocalDb } from "../../../../core/storage/localDb";
import { LocalVersionService } from "../../../../core/services/LocalVersionService";
import { setIndexingConsent } from "../../../../core/ai/indexingConsent";

vi.mock("../../../../shared/errors/reportError", () => ({ reportError: vi.fn() }));

describe("D4.18 Note Retriever Exclusion", () => {
  const NORMAL_ID = "local_normal_note";
  const EXCLUDED_ID = "local_excluded_note";

  beforeEach(async () => {
    vi.restoreAllMocks();
    setIndexingConsent("guest", "granted");
    setIndexingConsent("u1", "granted");
    invalidateMiniSearchCache();
    const db = await getLocalDb();
    for (const store of ["documents", "versions", "aiSummaries", "aiEmbeddings"] as const) {
      const all = await db.getAll(store);
      for (const rec of all) await db.delete(store, (rec as { id: string; documentId?: string }).id || (rec as { documentId: string }).documentId);
    }

    await db.put("documents", {
      id: NORMAL_ID, guestId: "u1", title: "Секретный рецепт пирога", currentVersion: 1,
      totalWords: 20, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
      excludedFromAI: false,
    } as never);

    await db.put("documents", {
      id: EXCLUDED_ID, guestId: "u1", title: "Личный дневник о пирогах", currentVersion: 1,
      totalWords: 20, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 2000, lastSessionAt: 2000, tags: [],
      excludedFromAI: true,
    } as never);

    vi.spyOn(AIService, "rerank").mockResolvedValue({ ok: false, error: "x" } as never);
    vi.spyOn(LocalVersionService, "getLatestContent").mockImplementation(async (id: string) =>
      id === NORMAL_ID
        ? "Обычный рецепт яблочного пирога с корицей."
        : "Очень личные мысли про пирог и семейные тайны."
    );
  });

  it("searchNotes excludes notes marked as excludedFromAI on keyword match", async () => {
    vi.spyOn(AIEmbeddingService, "getAll").mockResolvedValue([] as never);
    vi.spyOn(AIService, "embed").mockResolvedValue({ ok: true, vectors: [[0.1, 0.2, 0.3]] } as never);
    vi.spyOn(AIService, "rerank").mockResolvedValue({ ok: false, error: "x" } as never);

    const results = await searchNotes("пирог", 10);
    const ids = results.map(r => r.documentId);
    expect(ids).toContain(NORMAL_ID);
    expect(ids).not.toContain(EXCLUDED_ID);
  });

  it("searchNotes excludes notes marked as excludedFromAI on vector match", async () => {
    vi.spyOn(AIEmbeddingService, "getAll").mockResolvedValue([
      { documentId: NORMAL_ID, vectors: [[1, 0, 0]], contentHash: "h1", processedAt: 1, model: "m", dim: 3 },
      { documentId: EXCLUDED_ID, vectors: [[1, 0, 0]], contentHash: "h2", processedAt: 1, model: "m", dim: 3 },
    ] as never);
    vi.spyOn(AIService, "embed").mockResolvedValue({ ok: true, vectors: [[1, 0, 0]] } as never);
    vi.spyOn(AIService, "rerank").mockResolvedValue({ ok: false, error: "x" } as never);

    const results = await searchNotes("пирог", 10);
    const ids = results.map(r => r.documentId);
    expect(ids).toContain(NORMAL_ID);
    expect(ids).not.toContain(EXCLUDED_ID);
  });

  it("searchNotesMulti excludes notes marked as excludedFromAI", async () => {
    vi.spyOn(AIEmbeddingService, "getAll").mockResolvedValue([
      { documentId: NORMAL_ID, vectors: [[1, 0, 0]], contentHash: "h1", processedAt: 1, model: "m", dim: 3 },
      { documentId: EXCLUDED_ID, vectors: [[1, 0, 0]], contentHash: "h2", processedAt: 1, model: "m", dim: 3 },
    ] as never);
    vi.spyOn(AIService, "embed").mockResolvedValue({ ok: true, vectors: [[1, 0, 0]] } as never);

    const res = await searchNotesMulti(["пирог", "яблочный"], 10);
    const ids = res.notes.map(n => n.documentId);
    expect(ids).toContain(NORMAL_ID);
    expect(ids).not.toContain(EXCLUDED_ID);
  });

  it("findRelatedNotes excludes notes marked as excludedFromAI", async () => {
    vi.spyOn(AIEmbeddingService, "getAll").mockResolvedValue([
      { documentId: NORMAL_ID, vectors: [[1, 0, 0]], contentHash: "h1", processedAt: 1, model: "m", dim: 3 },
      { documentId: EXCLUDED_ID, vectors: [[1, 0, 0]], contentHash: "h2", processedAt: 1, model: "m", dim: 3 },
    ] as never);
    vi.spyOn(AIService, "embed").mockResolvedValue({ ok: true, vectors: [[1, 0, 0]] } as never);

    const results = await findRelatedNotes({ text: "пирог" });
    const ids = results.map(r => r.documentId);
    expect(ids).toContain(NORMAL_ID);
    expect(ids).not.toContain(EXCLUDED_ID);
  });

  it("invalidateMiniSearchCache immediately updates keyword search results after exclusion toggled", async () => {
    vi.spyOn(AIEmbeddingService, "getAll").mockResolvedValue([] as never);
    vi.spyOn(AIService, "embed").mockResolvedValue({ ok: true, vectors: [[0.1, 0.2, 0.3]] } as never);

    // Initial search: NORMAL_ID is found
    const res1 = await searchNotes("пирог", 10);
    expect(res1.map(r => r.documentId)).toContain(NORMAL_ID);

    // Exclude NORMAL_ID in local DB
    const db = await getLocalDb();
    const doc = await db.get("documents", NORMAL_ID);
    await db.put("documents", { ...doc!, excludedFromAI: true });

    // Invalidate cache
    invalidateMiniSearchCache();

    // Second search: NORMAL_ID is no longer found
    const res2 = await searchNotes("пирог", 10);
    expect(res2.map(r => r.documentId)).not.toContain(NORMAL_ID);
  });
});
