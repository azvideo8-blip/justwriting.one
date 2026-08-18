import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { getLocalDb, resetDbInstance, type LocalDocument, type AIDocumentSummary } from "../../../../core/storage/localDb";
import { type MigrationManifest } from "../migrationExport";
import { importMigrationManifest } from "../migrationImport";

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

describe("C1 migrationImport", () => {
  beforeEach(async () => {
    resetDbInstance();
    localStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("justwriting-local");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });

  it("Acceptance 3: drops aiPeopleIndex verbatim and strips mentionedPeople from aiSummaries (asserting on stored IDB records)", async () => {
    const manifest: MigrationManifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      documents: [
        {
          localId: "doc_1",
          uuid: "uuid-doc-1",
          title: "Заметка с людьми",
          currentVersion: 1,
          totalWords: 10,
          totalDuration: 10,
          sessionsCount: 1,
          firstSessionAt: 1000,
          lastSessionAt: 1000,
          tags: ["test"],
          versions: [
            {
              id: "ver_1",
              version: 1,
              content: "Текст заметки",
              wordCount: 2,
              wordsAdded: 2,
              charsAdded: 13,
              duration: 10,
              wpm: 60,
              savedAt: 1000,
              sessionStartedAt: 1000,
            },
          ],
        },
      ],
      drafts: [],
      aiSummaries: [
        {
          documentId: "doc_1",
          summary: "Сводка о людях",
          tone: "neutral",
          frequentWords: ["слово"],
          insights: ["мысль"],
          themes: ["тема"],
          extractedFacts: ["факт"],
          processedAt: 1000,
          contentHash: "h1",
          // Legacy field exported by older versions
          mentionedPeople: [
            { name: "Иван", role: "друг", facts: ["любит чай"] },
            { name: "Мария", role: "коллега", facts: [] },
          ],
        } as unknown as AIDocumentSummary,
      ],
      aiEmbeddings: [],
      verbatim: [
        {
          store: "aiPeopleIndex",
          key: "person_ivan",
          payload: { id: "person_ivan", name: "Иван", roles: ["друг"] },
        },
      ],
      counters: {
        documents: 1,
        versions: 1,
        drafts: 0,
        aiSummaries: 1,
        aiEmbeddings: 0,
        verbatim: { aiPeopleIndex: 1 },
      },
      checksums: {
        ver_1: await sha256Hex("Текст заметки"),
      },
      skipped: [],
    };

    const res = await importMigrationManifest(manifest, "u_test_1");
    expect(res.success).toBe(true);
    expect(res.droppedOnPurpose.peopleIndexRecords).toBe(1);
    expect(res.droppedOnPurpose.summariesWithMentionedPeople).toBe(1);

    const db = await getLocalDb();

    // 1. Assert aiPeopleIndex does NOT exist or has no records
    expect(db.objectStoreNames.contains("aiPeopleIndex" as never)).toBe(false);

    // 2. Assert stored summary in aiSummaries does NOT contain mentionedPeople
    const storedSummary = (await db.get("aiSummaries", "doc_1")) as unknown as Record<string, unknown>;
    expect(storedSummary).toBeDefined();
    expect(storedSummary.summary).toBe("Сводка о людях");
    expect("mentionedPeople" in storedSummary).toBe(false);
    expect(storedSummary.mentionedPeople).toBeUndefined();
  });

  it("Acceptance 4: importing the same manifest twice leaves exactly one copy of each document and version", async () => {
    const checksum = await sha256Hex("Контент первой версии");
    const manifest: MigrationManifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      documents: [
        {
          localId: "d1",
          uuid: "uuid-unique-1",
          title: "Заметка 1",
          currentVersion: 1,
          totalWords: 3,
          totalDuration: 10,
          sessionsCount: 1,
          firstSessionAt: 1000,
          lastSessionAt: 1000,
          tags: [],
          versions: [
            {
              id: "v1",
              version: 1,
              content: "Контент первой версии",
              wordCount: 3,
              wordsAdded: 3,
              charsAdded: 21,
              duration: 10,
              wpm: 60,
              savedAt: 1000,
              sessionStartedAt: 1000,
            },
          ],
        },
      ],
      drafts: [],
      aiSummaries: [],
      aiEmbeddings: [],
      verbatim: [],
      counters: { documents: 1, versions: 1, drafts: 0, aiSummaries: 0, aiEmbeddings: 0, verbatim: {} },
      checksums: { v1: checksum },
      skipped: [],
    };

    const res1 = await importMigrationManifest(manifest, "u1");
    expect(res1.imported.documents).toBe(1);
    expect(res1.imported.versions).toBe(1);

    const res2 = await importMigrationManifest(manifest, "u1");
    expect(res2.imported.documents).toBe(0);
    expect(res2.skipped.documents).toBe(1);
    expect(res2.imported.versions).toBe(0);
    expect(res2.skipped.versions).toBe(1);

    const db = await getLocalDb();
    const allDocs = await db.getAll("documents");
    const allVers = await db.getAll("versions");

    expect(allDocs).toHaveLength(1);
    expect(allVers).toHaveLength(1);
  });

  it("Acceptance 5: a version whose content does not match its checksum is skipped, appears in report with reason, rest completes", async () => {
    const validChecksum = await sha256Hex("Хорошая версия");
    const manifest: MigrationManifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      documents: [
        {
          localId: "d1",
          uuid: "uuid-1",
          title: "Заметка с битой версией",
          currentVersion: 2,
          totalWords: 10,
          totalDuration: 20,
          sessionsCount: 2,
          firstSessionAt: 1000,
          lastSessionAt: 2000,
          tags: [],
          versions: [
            {
              id: "v_bad",
              version: 1,
              content: "Испорченный текст",
              wordCount: 2,
              wordsAdded: 2,
              charsAdded: 16,
              duration: 10,
              wpm: 60,
              savedAt: 1000,
              sessionStartedAt: 1000,
            },
            {
              id: "v_good",
              version: 2,
              content: "Хорошая версия",
              wordCount: 2,
              wordsAdded: 2,
              charsAdded: 14,
              duration: 10,
              wpm: 60,
              savedAt: 2000,
              sessionStartedAt: 2000,
            },
          ],
        },
      ],
      drafts: [],
      aiSummaries: [],
      aiEmbeddings: [],
      verbatim: [],
      counters: { documents: 1, versions: 2, drafts: 0, aiSummaries: 0, aiEmbeddings: 0, verbatim: {} },
      checksums: {
        v_bad: "wrong_checksum_1234567890abcdef1234567890abcdef1234567890abcdef12345678",
        v_good: validChecksum,
      },
      skipped: [],
    };

    const res = await importMigrationManifest(manifest, "u1");
    expect(res.success).toBe(true);
    expect(res.imported.documents).toBe(1);
    expect(res.imported.versions).toBe(1);
    expect(res.skipped.versions).toBe(1);
    expect(res.skipped.details.some(d => d.id === "v_bad" && d.reason.includes("checksum mismatch"))).toBe(true);

    const db = await getLocalDb();
    const storedVersions = await db.getAll("versions");
    expect(storedVersions).toHaveLength(1);
    expect(storedVersions[0]!.id).toBe("v_good");
  });

  it("Acceptance 6: verbatim record for a store that does not exist is skipped without throwing", async () => {
    const manifest: MigrationManifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      documents: [],
      drafts: [],
      aiSummaries: [],
      aiEmbeddings: [],
      verbatim: [
        {
          store: "nonExistentLegacyStore_xyz",
          key: "k1",
          payload: { foo: "bar" },
        },
      ],
      counters: { documents: 0, versions: 0, drafts: 0, aiSummaries: 0, aiEmbeddings: 0, verbatim: { nonExistentLegacyStore_xyz: 1 } },
      checksums: {},
      skipped: [],
    };

    const res = await importMigrationManifest(manifest, "u1");
    expect(res.success).toBe(true);
    expect(res.droppedOnPurpose.unknownStores["nonExistentLegacyStore_xyz"]).toBe(1);
  });

  it("Acceptance 7: linkedCloudId is absent from imported documents", async () => {
    const manifest: MigrationManifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      documents: [
        {
          localId: "d1",
          uuid: "uuid-1",
          linkedCloudId: "firestore_doc_id_999",
          title: "Заметка с облачным ID",
          currentVersion: 1,
          totalWords: 1,
          totalDuration: 10,
          sessionsCount: 1,
          firstSessionAt: 1000,
          lastSessionAt: 1000,
          tags: [],
          versions: [],
        },
      ],
      drafts: [],
      aiSummaries: [],
      aiEmbeddings: [],
      verbatim: [],
      counters: { documents: 1, versions: 0, drafts: 0, aiSummaries: 0, aiEmbeddings: 0, verbatim: {} },
      checksums: {},
      skipped: [],
    };

    const res = await importMigrationManifest(manifest, "u1");
    expect(res.success).toBe(true);

    const db = await getLocalDb();
    const doc = (await db.get("documents", "d1")) as LocalDocument;
    expect(doc).toBeDefined();
    expect(doc.linkedCloudId).toBeUndefined();
  });

  it("Additional Acceptance: each stored record in aiSummaries, aiEmbeddings and aiTimeline resolves to an existing document in IndexedDB", async () => {
    const checksum = await sha256Hex("Текст");
    const manifest: MigrationManifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      documents: [
        {
          localId: "doc_alpha",
          uuid: "uuid-alpha",
          title: "Альфа",
          currentVersion: 1,
          totalWords: 1,
          totalDuration: 1,
          sessionsCount: 1,
          firstSessionAt: 1000,
          lastSessionAt: 1000,
          tags: [],
          versions: [
            {
              id: "v_alpha",
              version: 1,
              content: "Текст",
              wordCount: 1,
              wordsAdded: 1,
              charsAdded: 5,
              duration: 1,
              wpm: 60,
              savedAt: 1000,
              sessionStartedAt: 1000,
            },
          ],
        },
      ],
      drafts: [],
      aiSummaries: [
        {
          documentId: "doc_alpha",
          summary: "Сводка альфы",
          tone: "neutral",
          frequentWords: ["альфа"],
          insights: [],
          themes: [],
          extractedFacts: [],
          processedAt: 1000,
          contentHash: "h",
        },
        {
          documentId: "doc_non_existent",
          summary: "Осиротевшая сводка",
          tone: "neutral",
          frequentWords: [],
          insights: [],
          themes: [],
          extractedFacts: [],
          processedAt: 1000,
          contentHash: "h",
        },
      ],
      aiEmbeddings: [
        {
          documentId: "doc_alpha",
          vectors: [[1, 0, 0]],
          processedAt: 1000,
          contentHash: "h",
          model: "m",
          dim: 3,
        },
        {
          documentId: "doc_non_existent",
          vectors: [[0, 1, 0]],
          processedAt: 1000,
          contentHash: "h",
          model: "m",
          dim: 3,
        },
      ],
      verbatim: [
        {
          store: "aiTimeline",
          key: "doc_alpha",
          payload: { documentId: "doc_alpha", month: "2026-08", date: "2026-08-18", summary: "Лента альфы" },
        },
        {
          store: "aiTimeline",
          key: "doc_non_existent",
          payload: { documentId: "doc_non_existent", month: "2026-08", date: "2026-08-18", summary: "Лента сироты" },
        },
      ],
      counters: { documents: 1, versions: 1, drafts: 0, aiSummaries: 2, aiEmbeddings: 2, verbatim: { aiTimeline: 2 } },
      checksums: { v_alpha: checksum },
      skipped: [],
    };

    const res = await importMigrationManifest(manifest, "u1");
    expect(res.success).toBe(true);

    const db = await getLocalDb();

    // Iterate through all records in aiSummaries and ensure document exists
    const allSummaries = await db.getAll("aiSummaries");
    expect(allSummaries).toHaveLength(1);
    for (const s of allSummaries) {
      const parentDoc = await db.get("documents", s.documentId);
      expect(parentDoc).toBeDefined();
      expect(parentDoc?.id).toBe(s.documentId);
    }

    // Iterate through all records in aiEmbeddings and ensure document exists
    const allEmbeddings = await db.getAll("aiEmbeddings");
    expect(allEmbeddings).toHaveLength(1);
    for (const e of allEmbeddings) {
      const parentDoc = await db.get("documents", e.documentId);
      expect(parentDoc).toBeDefined();
      expect(parentDoc?.id).toBe(e.documentId);
    }

    // Iterate through all records in aiTimeline and ensure document exists
    const allTimeline = (await db.getAll("aiTimeline")) as { documentId: string }[];
    expect(allTimeline).toHaveLength(1);
    for (const t of allTimeline) {
      const parentDoc = await db.get("documents", t.documentId);
      expect(parentDoc).toBeDefined();
      expect(parentDoc?.id).toBe(t.documentId);
    }
  });

  it("ID Collision: renames document and rewrites all dependent records in one pass", async () => {
    const db = await getLocalDb();
    // Put an existing note with id "d_colliding" and uuid "uuid-existing"
    await db.put("documents", {
      id: "d_colliding",
      uuid: "uuid-existing",
      guestId: "u1",
      title: "Существующая заметка",
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
    });

    const checksum = await sha256Hex("Текст импортируемой заметки");
    const manifest: MigrationManifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      documents: [
        {
          localId: "d_colliding",
          uuid: "uuid-incoming-different",
          title: "Импортируемая заметка со столкнувшимся ID",
          currentVersion: 1,
          totalWords: 3,
          totalDuration: 10,
          sessionsCount: 1,
          firstSessionAt: 2000,
          lastSessionAt: 2000,
          tags: [],
          versions: [
            {
              id: "v_col",
              version: 1,
              content: "Текст импортируемой заметки",
              wordCount: 3,
              wordsAdded: 3,
              charsAdded: 27,
              duration: 10,
              wpm: 60,
              savedAt: 2000,
              sessionStartedAt: 2000,
            },
          ],
        },
      ],
      drafts: [],
      aiSummaries: [
        {
          documentId: "d_colliding",
          summary: "Сводка столкнувшейся",
          tone: "neutral",
          frequentWords: [],
          insights: [],
          themes: [],
          extractedFacts: [],
          processedAt: 2000,
          contentHash: "h",
        },
      ],
      aiEmbeddings: [
        {
          documentId: "d_colliding",
          vectors: [[1, 1, 0]],
          processedAt: 2000,
          contentHash: "h",
          model: "m",
          dim: 3,
        },
      ],
      verbatim: [
        {
          store: "aiTimeline",
          key: "d_colliding",
          payload: { documentId: "d_colliding", month: "2026-08", date: "2026-08-18", summary: "Лента" },
        },
      ],
      counters: { documents: 1, versions: 1, drafts: 0, aiSummaries: 1, aiEmbeddings: 1, verbatim: { aiTimeline: 1 } },
      checksums: { v_col: checksum },
      skipped: [],
    };

    const res = await importMigrationManifest(manifest, "u1");
    expect(res.success).toBe(true);
    expect(res.imported.documents).toBe(1);

    const allDocs = await db.getAll("documents");
    expect(allDocs).toHaveLength(2);

    const existingDoc = await db.get("documents", "d_colliding");
    expect(existingDoc?.uuid).toBe("uuid-existing");

    const incomingDoc = allDocs.find(d => d.uuid === "uuid-incoming-different");
    expect(incomingDoc).toBeDefined();
    expect(incomingDoc!.id).not.toBe("d_colliding");
    const newId = incomingDoc!.id;

    // Check version documentId
    const ver = await db.get("versions", "v_col");
    expect(ver?.documentId).toBe(newId);

    // Check summary documentId
    const summary = await db.get("aiSummaries", newId);
    expect(summary).toBeDefined();
    expect(summary?.summary).toBe("Сводка столкнувшейся");

    // Check embedding documentId
    const embedding = await db.get("aiEmbeddings", newId);
    expect(embedding).toBeDefined();

    // Check timeline documentId
    const timeline = (await db.get("aiTimeline", newId)) as { documentId: string } | undefined;
    expect(timeline).toBeDefined();
    expect(timeline?.documentId).toBe(newId);
  });

  it("Acceptance 8: full roundtrip: export real data, wipe DB, import manifest, verify archive sessions and analysis", async () => {
    const db = await getLocalDb();

    // 1. Create a rich set of notes in IndexedDB
    await db.put("documents", {
      id: "doc_archive_1",
      uuid: "uuid-arch-1",
      guestId: "u_arch",
      title: "Мой личный дневник",
      currentVersion: 2,
      totalWords: 50,
      totalDuration: 120,
      sessionsCount: 2,
      firstSessionAt: 1700000000000,
      lastSessionAt: 1700001000000,
      tags: ["дневник", "мысли"],
      labelId: "lbl_1",
      mood: "calm",
    });

    await db.put("versions", {
      id: "v_arch_1",
      documentId: "doc_archive_1",
      guestId: "u_arch",
      version: 1,
      content: "Первая запись в дневнике.",
      wordCount: 4,
      wordsAdded: 4,
      charsAdded: 25,
      duration: 60,
      wpm: 60,
      savedAt: 1700000000000,
      sessionStartedAt: 1700000000000,
      mood: "calm",
    });

    await db.put("versions", {
      id: "v_arch_2",
      documentId: "doc_archive_1",
      guestId: "u_arch",
      version: 2,
      content: "Вторая запись в дневнике: размышления о будущем.",
      wordCount: 7,
      wordsAdded: 7,
      charsAdded: 48,
      duration: 60,
      wpm: 60,
      savedAt: 1700001000000,
      sessionStartedAt: 1700001000000,
      mood: "calm",
    });

    await db.put("aiSummaries", {
      documentId: "doc_archive_1",
      summary: "Размышления автора о будущем и личных целях.",
      tone: "thoughtful",
      frequentWords: ["дневник", "будущее"],
      insights: ["Осознание важности записи мыслей"],
      themes: ["саморефлексия"],
      extractedFacts: [],
      processedAt: 1700001000000,
      contentHash: "hash123",
    });

    // 2. Export manifest
    const { exportMigrationManifest } = await import("../migrationExport");
    const manifest = await exportMigrationManifest();
    expect(manifest.counters.documents).toBe(1);
    expect(manifest.counters.versions).toBe(2);

    // 3. Wipe database completely
    resetDbInstance();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("justwriting-local");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    // 4. Import manifest
    const importRes = await importMigrationManifest(manifest, "u_arch");
    expect(importRes.success).toBe(true);
    expect(importRes.imported.documents).toBe(1);
    expect(importRes.imported.versions).toBe(2);
    expect(importRes.imported.aiSummaries).toBe(1);

    // 5. Verify restored state via UnifiedSessionLoader
    const { loadAllSessions, hydrateSessionContent } = await import(
      "../../../writing/services/UnifiedSessionLoader"
    );
    const { sessions: listed } = await loadAllSessions("u_arch", null);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.title).toBe("Мой личный дневник");
    expect(listed[0]!.id).toBe("doc_archive_1");
    expect(listed[0]!.tags).toEqual(["дневник", "мысли"]);

    const hydrated = await hydrateSessionContent(listed, "u_arch");
    expect(hydrated[0]!.content).toBe(
      "Вторая запись в дневнике: размышления о будущем."
    );

    // Verify summary is attached to this exact note
    const freshDb = await getLocalDb();
    const restoredSummary = await freshDb.get("aiSummaries", "doc_archive_1");
    expect(restoredSummary).toBeDefined();
    expect(restoredSummary?.summary).toBe(
      "Размышления автора о будущем и личных целях."
    );
  });
});
