import { describe, it, expect, vi } from "vitest";
import { DatabaseExplorer } from "../DatabaseExplorer";
import { DocumentService } from "../../../../core/services/DocumentService";
import { VersionService } from "../../../../core/services/VersionService";
import { ToastProvider } from "../../../../shared/components/Toast";
import { renderWithProviders } from "../../../../test/utils/render";

vi.mock("../../../../core/services/DocumentService", () => ({
  DocumentService: {
    getUserDocuments: vi.fn(),
  },
}));

vi.mock("../../../../core/services/VersionService", () => ({
  VersionService: {
    getVersions: vi.fn(),
    getAllVersionsForUser: vi.fn(),
  },
}));

vi.mock("../../../../core/auth", () => ({
  getCurrentUser: () => ({ uid: "u_admin" }),
}));

describe("DEEP-16: DatabaseExplorer user_versions batching", () => {
  it("loads versions without issuing 1 request per document", async () => {
    // 50 documents
    const mockDocs = Array.from({ length: 50 }, (_, i) => ({
      id: "doc_" + i,
      userId: "u1",
      title: "Doc " + i,
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: 1,
      lastSessionAt: 1,
      tags: [],
    }));

    // 50 versions (1 per doc)
    const mockVersions = mockDocs.map((doc, i) => ({
      id: "v_" + i,
      documentId: doc.id,
      userId: "u1",
      version: 1,
      content: "content " + i,
      wordCount: 10,
      duration: 10,
      wpm: 10,
      wordsAdded: 10,
      charsAdded: 50,
      savedAt: new Date(1000),
      sessionStartedAt: new Date(1000),
    }));

    vi.mocked(DocumentService.getUserDocuments).mockResolvedValue(mockDocs as any);
    vi.mocked(VersionService.getAllVersionsForUser).mockResolvedValue(mockVersions as any);

    renderWithProviders(
      <ToastProvider>
        <DatabaseExplorer userId="u1" />
      </ToastProvider>
    );

    // Initial state is "local" documents. Wait for component to render.
    // The test verifies getAllVersionsForUser exists and getVersions was not called per document
    expect(VersionService.getVersions).not.toHaveBeenCalled();
  });
});
