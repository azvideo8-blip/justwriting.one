import { describe, it, expect, vi } from "vitest";
import { VersionService } from "../VersionService";
import { DataProvider } from "../../data";

describe("DEEP-16: VersionService.getAllVersionsForUser", () => {
  it("fetches and parses all versions for user in one batch", async () => {
    const mockRecords = [
      {
        id: "v1_doc1",
        documentId: "doc1",
        userId: "u1",
        version: 1,
        content: "First version",
        wordCount: 2,
        wordsAdded: 2,
        charsAdded: 13,
        duration: 5,
        wpm: 24,
        goalReached: false,
        savedAt: 1000,
        sessionStartedAt: 1000,
      },
      {
        id: "v2_doc1",
        documentId: "doc1",
        userId: "u1",
        version: 2,
        content: "Second version",
        wordCount: 5,
        wordsAdded: 3,
        charsAdded: 14,
        duration: 10,
        wpm: 30,
        goalReached: true,
        savedAt: 2000,
        sessionStartedAt: 1500,
      },
    ];

    vi.spyOn(DataProvider, "getAllVersionsForUser").mockResolvedValue(mockRecords as any);

    const versions = await VersionService.getAllVersionsForUser("u1");

    expect(DataProvider.getAllVersionsForUser).toHaveBeenCalledTimes(1);
    expect(DataProvider.getAllVersionsForUser).toHaveBeenCalledWith("u1");
    expect(versions).toHaveLength(2);
    expect(versions[0]?.version).toBe(1);
    expect(versions[1]?.version).toBe(2);
    expect(versions[0]?.content).toBe("First version");
  });
});
