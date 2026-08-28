import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { NoteAnalysisService } from "../NoteAnalysisService";
import { AIService } from "../AIService";
import { AISummaryService } from "../AISummaryService";
import { AIEmbeddingService } from "../AIEmbeddingService";
import { getLocalDb } from "../../../../core/storage/localDb";
import { toggleAIExclusion } from "../../../archive/services/archiveCrud";
import { DocumentService } from "../../../../core/services/DocumentService";

vi.mock("../../../../shared/errors/reportError", () => ({ reportError: vi.fn() }));
vi.mock("../../../../core/auth", () => ({
  getCurrentUser: vi.fn(() => ({ uid: "u_test_123" })),
}));
vi.mock("../../../../core/data", () => ({
  DataProvider: {
    deleteSummary: vi.fn().mockResolvedValue(undefined),
    deleteEmbedding: vi.fn().mockResolvedValue(undefined),
    updateDocument: vi.fn().mockResolvedValue(undefined),
  },
}));

import { initAiDomainEvents } from "../../subscribeDomainEvents";

describe("D4.18 NoteAnalysisService & ArchiveCrud Exclusion", () => {
  const EXCLUDED_ID = "doc_excluded_1";
  let unsub: () => void;

  beforeEach(async () => {
    vi.restoreAllMocks();
    unsub = initAiDomainEvents();
    const db = await getLocalDb();
    for (const store of ["documents", "versions", "aiSummaries", "aiEmbeddings"] as const) {
      const all = await db.getAll(store);
      for (const rec of all) await db.delete(store, (rec as { id: string; documentId?: string }).id || (rec as { documentId: string }).documentId);
    }

    await db.put("documents", {
      id: EXCLUDED_ID,
      guestId: "u_test_123",
      title: "Скрытая от ИИ заметка",
      currentVersion: 1,
      totalWords: 100,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
      excludedFromAI: true,
      aiProcessed: true,
    } as never);

    await db.put("versions", {
      id: "v1",
      documentId: EXCLUDED_ID,
      guestId: "u_test_123",
      version: 1,
      content: "Длинный текст заметки, который больше 50 символов для проверки разбора.",
      wordCount: 10,
      wordsAdded: 10,
      charsAdded: 70,
      duration: 10,
      wpm: 60,
      goalReached: false,
      savedAt: 1000,
      sessionStartedAt: 1000,
    } as never);

    await db.put("aiSummaries", {
      documentId: EXCLUDED_ID,
      tone: "neutral",
      frequentWords: ["слово"],
      insights: ["мысль"],
      themes: ["тема"],
      extractedFacts: ["факт"],
      processedAt: 1000,
      contentHash: "hash",
      summary: "Старая сводка",
    });

    await AIEmbeddingService.save({
      documentId: EXCLUDED_ID,
      vectors: [[1, 2, 3]],
      processedAt: 1000,
      contentHash: "hash",
      model: "test-model",
      dim: 3,
    });
  });

  afterEach(() => {
    unsub?.();
  });

  it("analyze() returns early with { ok: false, error: 'EXCLUDED' } on excluded note", async () => {
    const summarizeSpy = vi.spyOn(AIService, "summarize");

    const result = await NoteAnalysisService.analyze(EXCLUDED_ID);

    expect(result).toEqual({ ok: false, error: "EXCLUDED" });
    expect(summarizeSpy).not.toHaveBeenCalled();
  });

  it("clear() deletes local summary, embedding and clears doc.aiProcessed", async () => {
    await NoteAnalysisService.clear(EXCLUDED_ID);

    const summary = await AISummaryService.get(EXCLUDED_ID);
    const embedding = await AIEmbeddingService.get(EXCLUDED_ID);
    const db = await getLocalDb();
    const doc = await db.get("documents", EXCLUDED_ID);

    expect(summary).toBeFalsy();
    expect(embedding).toBeFalsy();
    expect(doc?.aiProcessed).toBeUndefined();
  });

  it("toggleAIExclusion cleans up analysis and marks document excluded", async () => {
    const updateCloudSpy = vi.spyOn(DocumentService, "updateExcludedFromAI").mockResolvedValue();

    const session = {
      id: EXCLUDED_ID,
      title: "Скрытая от ИИ заметка",
      createdAt: new Date(),
      content: "Текст",
      duration: 10,
      wordCount: 10,
      charCount: 70,
      wpm: 60,
      userId: "u_test_123",
      _isLocal: true,
      _linkedCloudId: "cloud_doc_123",
      _hasCloudCopy: true,
      excludedFromAI: false,
    };

    const res = await toggleAIExclusion(
      session as never,
      true,
      { uid: "u_test_123" } as never,
      "u_test_123"
    );

    expect(res.success).toBe(true);

    const db = await getLocalDb();
    const doc = await db.get("documents", EXCLUDED_ID);
    expect(doc?.excludedFromAI).toBe(true);

    // Уборка разбора идёт через шину доменных событий и подгружает модули ИИ
    // динамически (иначе весь граф ИИ уезжает в стартовый бандл), поэтому она
    // асинхронна и наступает не в том же тике. Ждём её явно: если подписчик
    // не отработает, waitFor истечёт и тест покраснеет — смысл проверки тот же.
    await vi.waitFor(async () => {
      const summary = await AISummaryService.get(EXCLUDED_ID);
      expect(summary).toBeFalsy();
    }, { timeout: 2000 });

    // Cloud update was requested
    expect(updateCloudSpy).toHaveBeenCalledWith("u_test_123", "cloud_doc_123", true);
  });
});
