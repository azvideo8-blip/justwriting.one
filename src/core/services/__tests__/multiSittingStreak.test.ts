import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getLocalDb, clearAllLocalStores } from '../../storage/localDb';
import { LocalDocumentService } from '../LocalDocumentService';
import { LocalVersionService } from '../LocalVersionService';
import { loadAllSessions } from '../UnifiedSessionLoader';
import { calculateStreak, getSessionDates } from '../../utils/utils';
import { useArchiveGrouping } from '../../../features/archive/hooks/useArchiveGrouping';
import { renderHook } from '@testing-library/react';
import { subDays, startOfDay } from 'date-fns';
import { Session, ArchiveSession } from '../../../types';

describe('DEEP-2: multi-sitting note history', () => {
  const userId = 'user_multi_sitting_test';

  beforeEach(async () => {
    await clearAllLocalStores(userId);
  });

  it('getSessionDates returns dates for all sittings', () => {
    const today = new Date();
    const day1 = subDays(today, 2);
    const day2 = subDays(today, 1);
    const day3 = today;

    const session: Session = {
      id: 'doc_1',
      userId,
      content: 'Version 3 content',
      duration: 300,
      wordCount: 150,
      sessionWordsAdded: 50,
      charCount: 0,
      wpm: 30,
      createdAt: day3,
      sessionStartTime: day3.getTime(),
      sittings: [
        { id: 'v1', documentId: 'doc_1', version: 1, sessionStartedAt: day1.getTime(), savedAt: day1.getTime(), wordsAdded: 50, duration: 100 },
        { id: 'v2', documentId: 'doc_1', version: 2, sessionStartedAt: day2.getTime(), savedAt: day2.getTime(), wordsAdded: 50, duration: 100 },
        { id: 'v3', documentId: 'doc_1', version: 3, sessionStartedAt: day3.getTime(), savedAt: day3.getTime(), wordsAdded: 50, duration: 100 },
      ],
    };

    const dates = getSessionDates(session);
    expect(dates.length).toBe(3);
    expect(startOfDay(dates[0]!).getTime()).toBe(startOfDay(day1).getTime());
    expect(startOfDay(dates[1]!).getTime()).toBe(startOfDay(day2).getTime());
    expect(startOfDay(dates[2]!).getTime()).toBe(startOfDay(day3).getTime());
  });

  it('calculateStreak yields 3 for a single note written across 3 consecutive days', () => {
    const today = new Date();
    const day1 = subDays(today, 2);
    const day2 = subDays(today, 1);
    const day3 = today;

    const session: Session = {
      id: 'doc_1',
      userId,
      content: 'Latest content',
      duration: 300,
      wordCount: 150,
      sessionWordsAdded: 50,
      charCount: 0,
      wpm: 30,
      createdAt: day3,
      sessionStartTime: day3.getTime(),
      sittings: [
        { id: 'v1', documentId: 'doc_1', version: 1, savedAt: day1.getTime(), wordsAdded: 50 },
        { id: 'v2', documentId: 'doc_1', version: 2, savedAt: day2.getTime(), wordsAdded: 50 },
        { id: 'v3', documentId: 'doc_1', version: 3, savedAt: day3.getTime(), wordsAdded: 50 },
      ],
    };

    const streak = calculateStreak([session]);
    expect(streak).toBe(3);
  });

  it('loadAllSessions populates sittings and maintains 1 row in archive grouping', async () => {
    const now = new Date();
    const day1 = subDays(now, 2);
    const day2 = subDays(now, 1);
    const day3 = now;

    // 1. Create document
    const docId = await LocalDocumentService.createDocument(userId, {
      title: 'Note spanning 3 days',
      tags: [],
    });

    // 2. Add 3 versions over 3 days
    await LocalVersionService.addVersion(userId, docId, {
      content: 'Day 1 words',
      previousContent: '',
      wordCount: 10,
      duration: 60,
      wpm: 10,
      versionNumber: 1,
      sessionStartedAt: day1,
      savedAt: day1,
    });

    await LocalVersionService.addVersion(userId, docId, {
      content: 'Day 1 words and Day 2 words',
      previousContent: 'Day 1 words',
      wordCount: 20,
      duration: 60,
      wpm: 10,
      versionNumber: 2,
      sessionStartedAt: day2,
      savedAt: day2,
    });

    await LocalVersionService.addVersion(userId, docId, {
      content: 'Day 1 words and Day 2 words and Day 3 words',
      previousContent: 'Day 1 words and Day 2 words',
      wordCount: 30,
      duration: 60,
      wpm: 10,
      versionNumber: 3,
      sessionStartedAt: day3,
      savedAt: day3,
    });

    // Update document metadata as StorageService does
    const db = await getLocalDb(userId);
    const doc = await db.get('documents', docId);
    if (doc) {
      await db.put('documents', {
        ...doc,
        sessionsCount: 3,
        firstSessionAt: day1.getTime(),
        lastSessionAt: day3.getTime(),
        totalWords: 30,
        totalDuration: 180,
      });
    }

    // 3. Load all sessions via UnifiedSessionLoader
    const { sessions } = await loadAllSessions(userId, null);
    expect(sessions.length).toBe(1);
    const s = sessions[0]!;
    expect(s.id).toBe(docId);
    expect(s.sittings).toBeDefined();
    expect(s.sittings?.length).toBe(3);

    // 4. Check streak calculation over this loaded session
    const streak = calculateStreak(sessions);
    expect(streak).toBe(3);

    // 5. Check archive grouping: must show exactly 1 note card
    const { result } = renderHook(() => useArchiveGrouping(sessions as unknown as ArchiveSession[]));
    const allGroupedNotes = Object.values(result.current.groupedSessions).flat();
    expect(allGroupedNotes.length).toBe(1);
    expect(allGroupedNotes[0]!.id).toBe(docId);
  });

  it('перенесённая дата заметки считается днём серии вместе с днём подхода (02.11)', () => {
    const today = startOfDay(new Date());
    const mk = (id: string, noteDay: Date, wroteAt: Date): Session => ({
      id, userId, content: 'x', duration: 60, wordCount: 10, sessionWordsAdded: 10, charCount: 0, wpm: 0,
      createdAt: noteDay, sessionStartTime: noteDay.getTime(),
      sittings: [{ id: `${id}-v1`, documentId: id, version: 1, sessionStartedAt: wroteAt.getTime(), savedAt: wroteAt.getTime(), wordsAdded: 10, duration: 60 }],
    });
    // Две заметки написаны сегодня и перенесены на вчера и позавчера; до них — два обычных дня.
    const sessions = [
      mk('d0', today, today),
      mk('d1', subDays(today, 1), today),
      mk('d2', subDays(today, 2), today),
      mk('d3', subDays(today, 3), subDays(today, 3)),
      mk('d4', subDays(today, 4), subDays(today, 4)),
    ];
    expect(getSessionDates(sessions[1]!).map(d => d.getTime()).sort()).toEqual([subDays(today, 1).getTime(), today.getTime()]);
    expect(calculateStreak(sessions, new Set())).toBe(5);
  });
});

