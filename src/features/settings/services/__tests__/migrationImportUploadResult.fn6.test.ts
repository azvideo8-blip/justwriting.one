// FN-6 (дейлик 20.11, Н-6): отчёт импорта считает queued по факту постановки в очередь —
// не по failed; заметка, не вставшая в очередь, называется, а не «ждёт выгрузки».
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { resetDbInstance } from "../../../../core/storage/localDb";
import { importMigrationManifest } from "../migrationImport";
import { SyncService } from "../../../../core/services/SyncService";
import { type MigrationManifest } from "../migrationExport";
import { STORAGE_KEYS } from "../../../../shared/constants/storageKeys";
import { generateDataKey, setSessionKey, clearSessionKey } from "../../../../core/crypto/encrypt";

vi.mock("../../../../shared/errors/reportError", () => ({ reportError: vi.fn() }));

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function manifestWith(ids: string[]): Promise<MigrationManifest> {
  const documents = [];
  const checksums: Record<string, string> = {};
  for (const [i, localId] of ids.entries()) {
    const content = `Текст заметки ${i}`;
    checksums[`v_${localId}`] = await sha256Hex(content);
    documents.push({
      localId,
      uuid: `uuid-${localId}`,
      title: `Заметка ${i}`,
      currentVersion: 1,
      totalWords: 2,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
      versions: [{
        id: `v_${localId}`,
        version: 1,
        content,
        wordCount: 2,
        wordsAdded: 2,
        charsAdded: content.length,
        duration: 10,
        wpm: 60,
        savedAt: 1000,
        sessionStartedAt: 1000,
      }],
    });
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    documents,
    drafts: [],
    aiSummaries: [],
    aiEmbeddings: [],
    verbatim: [],
    counters: { documents: ids.length, versions: ids.length, drafts: 0, aiSummaries: 0, aiEmbeddings: 0, verbatim: {} },
    checksums,
    skipped: [],
  } as unknown as MigrationManifest;
}


describe("FN-6: итог выгрузки импорта", () => {
  beforeEach(async () => {
    resetDbInstance();
    vi.restoreAllMocks();
    localStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("justwriting-local-u_fn6i");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED("u_fn6i"), "true");
    setSessionKey(await generateDataKey());
  });

  it("failed больше queued — status failed, queued не завышен, причина названа", async () => {
    vi.spyOn(SyncService, "syncAllUnlinked").mockResolvedValue({ synced: 1, failed: 2, queued: 1 });
    const res = await importMigrationManifest(await manifestWith(["doc_fn6i_a", "doc_fn6i_b"]), "u_fn6i");
    expect(res.upload?.status).toBe("failed");
    expect(res.upload?.uploaded).toBe(1);
    expect(res.upload?.queued).toBe(1);
    expect(res.upload?.reason).toContain("1 note(s)");
    clearSessionKey();
  });

  it("сейф заперт посреди выгрузки — status vault_locked", async () => {
    vi.spyOn(SyncService, "syncAllUnlinked").mockResolvedValue({ synced: 0, failed: 1, queued: 1, skippedReason: "vault_locked" });
    const res = await importMigrationManifest(await manifestWith(["doc_fn6i_c"]), "u_fn6i");
    expect(res.upload?.status).toBe("vault_locked");
    expect(res.upload?.queued).toBe(1);
    clearSessionKey();
  });

  it("КОНТРОЛЬ: всё ушло — completed, queued 0", async () => {
    vi.spyOn(SyncService, "syncAllUnlinked").mockResolvedValue({ synced: 2, failed: 0, queued: 0 });
    const res = await importMigrationManifest(await manifestWith(["doc_fn6i_d", "doc_fn6i_e"]), "u_fn6i");
    expect(res.upload?.status).toBe("completed");
    expect(res.upload?.queued).toBe(0);
    expect(res.upload?.reason).toBeUndefined();
    clearSessionKey();
  });
});
