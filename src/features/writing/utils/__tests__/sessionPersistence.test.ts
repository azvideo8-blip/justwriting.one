import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSessionPayload } from '../sessionPersistence';
import { Timestamp } from 'firebase/firestore';

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

  it('sets userId from parameter', () => {
    const result = buildSessionPayload(baseState, null, null, 'user123');
    expect(result.userId).toBe('user123');
  });

  it('authorName from profile nickname', () => {
    const profile = { nickname: 'Nick' } as any;
    const result = buildSessionPayload(baseState, profile, null, 'u1');
    expect(result.authorName).toBe('Nick');
  });

  it('authorName fallback to user displayName', () => {
    const user = { displayName: 'Display' } as any;
    const result = buildSessionPayload(baseState, null, user, 'u1');
    expect(result.authorName).toBe('Display');
  });

  it('authorName fallback to email prefix', () => {
    const user = { email: 'test@example.com' } as any;
    const result = buildSessionPayload(baseState, null, user, 'u1');
    expect(result.authorName).toBe('test');
  });

  it('authorName fallback to Guest', () => {
    const result = buildSessionPayload(baseState, null, null, 'u1');
    expect(result.authorName).toBe('Guest');
  });

  it('charCount = content.length', () => {
    const result = buildSessionPayload(baseState, null, null, 'u1');
    expect(result.charCount).toBe(baseState.content.length);
  });

  it('goalReached = true for free session type', () => {
    const result = buildSessionPayload({ ...baseState, sessionType: 'free' }, null, null, 'u1');
    expect(result.goalReached).toBe(true);
  });

  it('goalReached = timeGoalReached for timer type', () => {
    const result = buildSessionPayload({ ...baseState, sessionType: 'timer', timeGoalReached: true }, null, null, 'u1');
    expect(result.goalReached).toBe(true);
  });

  it('goalReached = wordGoalReached for words type', () => {
    const result = buildSessionPayload({ ...baseState, sessionType: 'words', wordGoalReached: true }, null, null, 'u1');
    expect(result.goalReached).toBe(true);
  });

  it('includes updatedAt as Timestamp', () => {
    const result = buildSessionPayload(baseState, null, null, 'u1');
    expect(result.updatedAt).toBeInstanceOf(Timestamp);
  });
});
