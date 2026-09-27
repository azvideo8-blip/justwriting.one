import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { getLocalDb, resetDbInstance } from "../../../../core/storage/localDb";
import { importMigrationManifest } from "../migrationImport";
import { SyncService } from "../../../../core/services/SyncService";
import { type MigrationManifest } from "../migrationExport";
import { STORAGE_KEYS } from "../../../../shared/constants/storageKeys";

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../../../shared/errors/reportError", () => ({ reportError }));

/**
 * SB-7: импорт при запертом сейфе ставит заметки в очередь на выгрузку, а падение
 * самой записи в очередь глохло в `catch {}`. Молчание враньё дважды: потерянную
 * задачу никто не замечал, и отчёт продолжал нести `queued = importedDocIds.length`,
 * которое экран импорта показывает как «N заметок ждут выгрузки».
 */

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

describe("SB-7: очередь не записана — импорт говорит честно", () => {
  beforeEach(async () => {
    resetDbInstance();
    reportError.mockReset();
    localStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("justwriting-local-u_sb7");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED("u_sb7"), "true");
  });

  it('запись в очередь падает: про это сообщают, queued считает вставшие задачи', async () => {
    const ids = ["doc_sb7_a", "doc_sb7_b"];
    const original = SyncService.addToQueue;
    vi.spyOn(SyncService, "addToQueue").mockImplementation(async (docId: string) => {
      if (docId === ids[1]) throw new Error("QuotaExceededError");
      await original(docId, "u_sb7");
    });

    const res = await importMigrationManifest(await manifestWith(ids), "u_sb7");

    expect(res.upload?.status).toBe("vault_locked");
    const db = await getLocalDb("u_sb7");
    const queued = await db.getAll("syncQueue");
    expect(queued.map(q => q.documentId)).toEqual([ids[0]]);
    expect(res.upload?.queued).toBe(1);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('очередь записалась целиком: queued = все заметки, репорта нет', async () => {
    const res = await importMigrationManifest(await manifestWith(["doc_sb7_c", "doc_sb7_d"]), "u_sb7");

    expect(res.upload?.queued).toBe(2);
    expect(reportError).not.toHaveBeenCalled();
  });
});
