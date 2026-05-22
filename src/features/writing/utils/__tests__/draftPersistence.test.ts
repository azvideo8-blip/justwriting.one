import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildLocalDraft, persistDraft } from '../draftPersistence';
import { WritingDraftService } from '../../services/WritingDraftService';

vi.mock('../../services/WritingDraftService', () => ({
  WritingDraftService: {
    saveToLocal: vi.fn().mockResolvedValue(undefined),
    saveToFirestore: vi.fn().mockResolvedValue(undefined),
    clearLegacyDraft: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../shared/lib/localStorageUtils', () => ({
  getLocalStorageUsageKB: vi.fn().mockReturnValue(100),
}));

const mockUser = { uid: 'test-uid', email: 'test@test.com' } as any;

describe('buildLocalDraft', () => {
  it('sets updatedAt to current timestamp', () => {
    const before = Date.now();
    const draft = buildLocalDraft(mockUser, {
      title: 'Test',
      content: 'Hello',
      pinnedThoughts: [],
      seconds: 60,
      wpm: 30,
      wordCount: 100,
      activeSessionId: null,
      status: 'writing',
    });
    expect(draft.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('spreads draftData fields onto result', () => {
    const draft = buildLocalDraft(mockUser, {
      title: 'My Title',
      content: 'My Content',
      pinnedThoughts: ['thought1'],
      seconds: 120,
      wpm: 40,
      wordCount: 200,
      activeSessionId: null,
      status: 'writing',
    });
    expect(draft.title).toBe('My Title');
    expect(draft.content).toBe('My Content');
    expect(draft.pinnedThoughts).toEqual(['thought1']);
    expect(draft.seconds).toBe(120);
  });

  it('sessionStartTime null when not provided', () => {
    const draft = buildLocalDraft(mockUser, {
      title: '',
      content: '',
      pinnedThoughts: [],
      seconds: 0,
      wpm: 0,
      wordCount: 0,
      activeSessionId: null,
      status: 'writing',
    });
    expect(draft.sessionStartTime).toBeNull();
  });
});

describe('persistDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls saveToLocal and saveToFirestore in parallel', async () => {
    const draft = { userId: 'u1', content: 'test' } as any;
    await persistDraft(draft);
    expect(WritingDraftService.saveToLocal).toHaveBeenCalledWith(draft);
    expect(WritingDraftService.saveToFirestore).toHaveBeenCalledWith(draft);
  });

  it('localOk=true when saveToLocal resolves', async () => {
    const result = await persistDraft({ userId: 'u1' } as any);
    expect(result.localOk).toBe(true);
  });

  it('remoteOk=false when saveToFirestore rejects, localOk still true', async () => {
    (WritingDraftService.saveToFirestore as any).mockRejectedValueOnce(new Error('fail'));
    const result = await persistDraft({ userId: 'u1' } as any);
    expect(result.localOk).toBe(true);
    expect(result.remoteOk).toBe(false);
  });

  it('warns in console when localStorage > 4500 KB', async () => {
    const { getLocalStorageUsageKB } = await import('../../../../shared/lib/localStorageUtils');
    (getLocalStorageUsageKB as any).mockReturnValue(5000);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await persistDraft({ userId: 'u1' } as any);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
