import { describe, it, expect } from "vitest";
import { findMatch } from "../OnThisDayCard";
import { ArchiveSession } from "../../types";

describe("DEEP-12: OnThisDay month boundary clamping", () => {
  const t = (k: string) => k;

  it("clamps 31 March to 28 February (or 29 Feb in leap year), not 3 March", () => {
    // Reference date: 2026-03-31
    const refDate = new Date(2026, 2, 31); // Month is 0-indexed: 2 = March

    // Session on 2026-02-28 (last day of February in 2026)
    const sessionFeb28: ArchiveSession = {
      id: "session_feb28",
      userId: "user_1",
      sessionStartTime: new Date(2026, 1, 28, 12, 0).getTime(),
      createdAt: new Date(2026, 1, 28, 12, 0).getTime(),
      duration: 300,
      wordCount: 100,
      charCount: 500,
      wpm: 20,
      content: "Wrote on Feb 28",
    };

    // Session on 2026-03-03 (overflow date from buggy native setMonth)
    const sessionMar03: ArchiveSession = {
      id: "session_mar03",
      userId: "user_1",
      sessionStartTime: new Date(2026, 2, 3, 12, 0).getTime(),
      createdAt: new Date(2026, 2, 3, 12, 0).getTime(),
      duration: 150,
      wordCount: 50,
      charCount: 250,
      wpm: 20,
      content: "Wrote on Mar 03",
    };

    const matchFeb = findMatch([sessionFeb28], t, refDate);
    expect(matchFeb).not.toBeNull();
    expect(matchFeb?.session.id).toBe("session_feb28");
    expect(matchFeb?.label).toBe("archive_on_this_day_month");

    // Make sure March 3 is NOT matched as 1 month ago from March 31
    const matchMar03 = findMatch([sessionMar03], t, refDate);
    expect(matchMar03).toBeNull();
  });

  it("clamps 31 May to 30 April, not 1 May", () => {
    const refDate = new Date(2026, 4, 31); // 4 = May

    const sessionApr30: ArchiveSession = {
      id: "session_apr30",
      userId: "user_1",
      sessionStartTime: new Date(2026, 3, 30, 12, 0).getTime(),
      createdAt: new Date(2026, 3, 30, 12, 0).getTime(),
      duration: 200,
      wordCount: 80,
      charCount: 400,
      wpm: 24,
      content: "Wrote on Apr 30",
    };

    const matchApr = findMatch([sessionApr30], t, refDate);
    expect(matchApr).not.toBeNull();
    expect(matchApr?.session.id).toBe("session_apr30");
    expect(matchApr?.label).toBe("archive_on_this_day_month");
  });

  it("E-6: returns matchedDate corresponding to sitting date, even when createdAt differs", () => {
    // Note was created 2 years ago (2024-09-07)
    // But had an edit sitting exactly 1 month ago (2026-08-07)
    const refDate = new Date(2026, 8, 7, 12, 0); // 2026-09-07
    const oneMonthAgo = new Date(2026, 7, 7, 12, 0); // 2026-08-07

    const multiSittingSession: ArchiveSession = {
      id: "session_multi_sitting",
      userId: "user_1",
      createdAt: new Date(2024, 8, 7, 10, 0).getTime(), // 2 years ago
      duration: 300,
      wordCount: 500,
      charCount: 2500,
      wpm: 30,
      content: "A note created 2 years ago with an anniversary sitting 1 month ago",
      sittings: [
        {
          id: "sit_old",
          documentId: "session_multi_sitting",
          version: 1,
          savedAt: new Date(2024, 8, 7, 10, 0).getTime(),
        },
        {
          id: "sit_anniversary",
          documentId: "session_multi_sitting",
          version: 2,
          savedAt: oneMonthAgo.getTime(),
        },
      ],
    };

    const match = findMatch([multiSittingSession], t, refDate);
    expect(match).not.toBeNull();
    expect(match?.session.id).toBe("session_multi_sitting");
    expect(match?.label).toBe("archive_on_this_day_month");
    // matchedDate is 2026-08-07, NOT 2024-09-07
    expect(match?.matchedDate.getFullYear()).toBe(2026);
    expect(match?.matchedDate.getMonth()).toBe(7); // August
    expect(match?.matchedDate.getDate()).toBe(7);
  });
});
