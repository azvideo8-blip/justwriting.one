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
});
