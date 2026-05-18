import { describe, it, expect, vi } from 'vitest';
import { buildSessionPayload } from '../sessionPersistence';

vi.mock('../../../core/firebase/firestoreClient', () => ({
  getClient: () => ({
    mod: {
      Timestamp: {
        now: () => ({ seconds: 123, nanoseconds: 0 }),
        fromDate: (d: Date) => ({ seconds: d.getTime() / 1000, nanoseconds: 0 }),
      },
    },
  }),
}));

describe('buildSessionPayload', () => {
  const baseState = {
    title: 'Test Title',
    content: 'Test content here',
    pinnedThoughts: ['thought1'],
    seconds: 300,
    wordCount: 500,
    wpm: 60,
    tags: ['tag1'],
    sessionType: 'free' as const,
    sessionStartTime: null as number | null,
    timeGoalReached: false,
    wordGoalReached: false,
  };

  it('sets userId from parameter', async () => {
    const result = await buildSessionPayload(baseState, null, null, 'user123');
    expect(result.userId).toBe('user123');
  });

  it('does not include authorName (PII removed)', async () => {
    const result = await buildSessionPayload(baseState, null, null, 'u1');
    expect(result.authorName).toBeUndefined();
  });

  it('does not include authorPhoto (PII removed)', async () => {
    const result = await buildSessionPayload(baseState, null, null, 'u1');
    expect(result.authorPhoto).toBeUndefined();
  });

  it('does not include nickname (PII removed)', async () => {
    const result = await buildSessionPayload(baseState, { nickname: 'Nick' } as any, null, 'u1');
    expect(result.nickname).toBeUndefined();
  });

  it('charCount = content.length', async () => {
    const result = await buildSessionPayload(baseState, null, null, 'u1');
    expect(result.charCount).toBe(baseState.content.length);
  });

  it('goalReached = true for free session type', async () => {
    const result = await buildSessionPayload({ ...baseState, sessionType: 'free' }, null, null, 'u1');
    expect(result.goalReached).toBe(true);
  });

  it('goalReached = timeGoalReached for timer type', async () => {
    const result = await buildSessionPayload({ ...baseState, sessionType: 'timer', timeGoalReached: true }, null, null, 'u1');
    expect(result.goalReached).toBe(true);
  });

  it('goalReached = wordGoalReached for words type', async () => {
    const result = await buildSessionPayload({ ...baseState, sessionType: 'words', wordGoalReached: true }, null, null, 'u1');
    expect(result.goalReached).toBe(true);
  });

  it('includes updatedAt', async () => {
    const result = await buildSessionPayload(baseState, null, null, 'u1');
    expect(result.updatedAt).toBeDefined();
  });
});
