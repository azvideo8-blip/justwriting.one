import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { calculateStreak, calculateBestStreak, consumeStreakFreezes } from '../utils';
import type { Session } from '../../../types';
import { getLocalDb } from '../../storage/localDb';
import { LocalDocumentService } from '../../services/LocalDocumentService';
import { LocalVersionService } from '../../services/LocalVersionService';
import { subDays } from 'date-fns';

function makeSession(daysAgo: number): Session {
  const date = subDays(new Date(), daysAgo);
  return {
    id: `s_${daysAgo}`,
    userId: 'u1',
    sessionStartTime: date.getTime(),
    createdAt: date.getTime(),
    content: 'test',
    wordCount: 10,
    charCount: 40,
    duration: 60,
    wpm: 30,
  };
}

describe('AG-STAT-1: Statistics & Counter Integrity', () => {
  beforeEach(async () => {
    // Без этого vi.spyOn на уже подменённом методе возвращает тот же шпион с
    // историей вызовов прошлого теста: проверка «не вызывался» проходит только
    // потому, что тест идёт первым.
    vi.restoreAllMocks();
    localStorage.clear();
    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('profile');
  });

  it('Requirement 1: calculateStreak is a pure function and never writes to localStorage when filtering sessions', () => {
    // Gap on day 2 (0, 1, 3) would trigger a streak freeze
    const sessions = [makeSession(0), makeSession(1), makeSession(3)];
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

    const streak = calculateStreak(sessions);
    expect(streak).toBe(4); // 0, 1, (freeze 2), 3 = 4
    expect(storageSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('streak_frozen_dates')).toBeNull();

    // Now call consumeStreakFreezes explicitly (profile stats path)
    consumeStreakFreezes(sessions);
    expect(storageSpy).toHaveBeenCalled();
    expect(localStorage.getItem('jw_streak_freezes')).not.toBeNull();
  });

  // Близнец calculateStreak. Её тоже зовут из рендера — StreakRibbon и
  // Achievements, — и она тоже писала заморозки. Два вычислителя строили Set из
  // getFrozenDates() в разное время, и сохранявший последним откатывал чужое.
  it('calculateBestStreak тоже чистая и не пишет в localStorage', () => {
    const sessions = [makeSession(0), makeSession(1), makeSession(3)];
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

    const best = calculateBestStreak(sessions);

    expect(best).toBeGreaterThan(0);
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it('Requirement 2: continuing an old note with 5 existing sessions increments profile sessionsCount by exactly +1', async () => {
    const db = await getLocalDb();
    const docId = 'doc_continuing_test';
    const guestId = 'guest_1';

    // Seed document with 5 sessions and profile with 10 sessions
    await db.put('documents', {
      id: docId,
      guestId,
      title: 'Старая заметка',
      totalWords: 500,
      totalDuration: 1000,
      currentVersion: 5,
      sessionsCount: 5,
      firstSessionAt: 1000,
      lastSessionAt: 5000,
      tags: [],
    } as never);

    await db.put('profile', {
      guestId,
      totalWords: 1000,
      totalDuration: 2000,
      sessionsCount: 10,
      lastSessionAt: 5000,
      createdAt: 1000,
    } as never);

    // Update after 6th session
    await LocalDocumentService.updateAfterSession(docId, {
      totalWords: 600,
      totalDuration: 1200,
      currentVersion: 6,
    });

    const updatedDoc = await db.get('documents', docId);
    expect(updatedDoc?.sessionsCount).toBe(6);

    const updatedProfile = await db.get('profile', guestId);
    // Profile should increase from 10 to 11 (NOT drop to 10 - 5 + 1 = 6!)
    expect(updatedProfile?.sessionsCount).toBe(11);
  });

  it('Requirement 4: sequential saves produce distinct incremented version numbers', async () => {
    const db = await getLocalDb();
    const docId = 'doc_versions_test';
    const guestId = 'guest_2';

    await db.put('documents', {
      id: docId,
      guestId,
      title: 'Заметка версий',
      totalWords: 10,
      totalDuration: 20,
      currentVersion: 1,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
    } as never);

    await db.put('versions', {
      id: 'v1',
      documentId: docId,
      guestId,
      version: 1,
      content: 'Первая версия',
      wordCount: 10,
      wordsAdded: 10,
      charsAdded: 20,
      duration: 20,
      wpm: 30,
      savedAt: 1000,
      sessionStartedAt: 1000,
    } as never);

    // Save version 2
    const currentVer = (await LocalDocumentService.getDocument(docId))?.currentVersion ?? 0;
    const nextVer2 = currentVer + 1;
    await LocalVersionService.addVersion(guestId, docId, {
      content: 'Вторая версия',
      previousContent: 'Первая версия',
      wordCount: 15,
      duration: 25,
      wpm: 35,
      versionNumber: nextVer2,
      sessionStartedAt: new Date(2000),
    });
    await LocalDocumentService.updateAfterSession(docId, {
      totalWords: 15,
      totalDuration: 25,
      currentVersion: nextVer2,
    });

    // Save version 3
    const currentVerAfter2 = (await LocalDocumentService.getDocument(docId))?.currentVersion ?? 0;
    const nextVer3 = currentVerAfter2 + 1;
    await LocalVersionService.addVersion(guestId, docId, {
      content: 'Третья версия',
      previousContent: 'Вторая версия',
      wordCount: 20,
      duration: 30,
      wpm: 40,
      versionNumber: nextVer3,
      sessionStartedAt: new Date(3000),
    });
    await LocalDocumentService.updateAfterSession(docId, {
      totalWords: 20,
      totalDuration: 30,
      currentVersion: nextVer3,
    });

    const versions = await LocalVersionService.getVersions(docId);
    const versionNumbers = versions.map(v => v.version).sort((a, b) => a - b);
    expect(versionNumbers).toEqual([1, 2, 3]);

    const latestContent = await LocalVersionService.getLatestContent(docId);
    expect(latestContent).toBe('Третья версия');
  });
});
