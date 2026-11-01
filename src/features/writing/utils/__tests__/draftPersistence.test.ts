import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildLocalDraft, persistDraft } from '../draftPersistence';
import { WritingDraftService } from '../../services/WritingDraftService';

vi.mock('../../services/WritingDraftService', () => ({
  WritingDraftService: {
    getDraftGeneration: vi.fn().mockReturnValue(0),
    bumpDraftGeneration: vi.fn().mockReturnValue(1),
    saveToLocal: vi.fn().mockResolvedValue(undefined),
    saveDraftToCloud: vi.fn().mockResolvedValue(true),
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

  it('calls saveToLocal and saveDraftToCloud in parallel with generation', async () => {
    const draft = { userId: 'u1', content: 'test' } as any;
    await persistDraft(draft, { generation: 0 });
    expect(WritingDraftService.saveToLocal).toHaveBeenCalledWith(draft, 0);
    expect(WritingDraftService.saveDraftToCloud).toHaveBeenCalledWith(draft, 0);
  });

  it('localOk=true when saveToLocal resolves', async () => {
    const result = await persistDraft({ userId: 'u1' } as any, { generation: 0 });
    expect(result.localOk).toBe(true);
    expect(result.remoteOk).toBe(true);
  });

  it('remoteOk=false when saveDraftToCloud rejects, localOk still true', async () => {
    const mockError = new Error('fail');
    (WritingDraftService.saveDraftToCloud as any).mockRejectedValueOnce(mockError);
    const result = await persistDraft({ userId: 'u1' } as any, { generation: 0 });
    expect(result.localOk).toBe(true);
    expect(result.remoteOk).toBe(false);
    expect(result.remoteError).toBe(mockError);
  });

  it('remoteOk=false when saveDraftToCloud returns false', async () => {
    (WritingDraftService.saveDraftToCloud as any).mockResolvedValueOnce(false);
    const result = await persistDraft({ userId: 'u1' } as any, { generation: 0 });
    expect(result.localOk).toBe(true);
    expect(result.remoteOk).toBe(false);
  });

  it('D-1: localOk=false when saveToLocal rejects (no false-positive "Saved")', async () => {
    (WritingDraftService.saveToLocal as any).mockRejectedValueOnce(new Error('IDB fail'));
    const result = await persistDraft({ userId: 'u1' } as any, { generation: 0 });
    expect(result.localOk).toBe(false);
  });

  it('warns in console when localStorage > 4500 KB', async () => {
    const { getLocalStorageUsageKB } = await import('../../../../shared/lib/localStorageUtils');
    (getLocalStorageUsageKB as any).mockReturnValue(5000);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await persistDraft({ userId: 'u1' } as any, { generation: 0 });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // DY10-10: прежнее `options.generation ?? getDraftGeneration(...)` подставляло
  // текущее поколение, и отсроченная запись после сохранения заметки проходила.
  // Мутация: вернуть подстановку — красный.
  it('не подставляет текущее поколение вместо названного вызывающим', async () => {
    (WritingDraftService.getDraftGeneration as any).mockReturnValue(7);
    await persistDraft({ userId: 'u1' } as any, { generation: 3 });
    expect(WritingDraftService.saveToLocal).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), 3);
    expect(WritingDraftService.saveDraftToCloud).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), 3);
    expect(WritingDraftService.getDraftGeneration).not.toHaveBeenCalled();
  });

  // DY10-10: вызывающий, который не знает поколения, обязан получить `undefined`
  // — тогда страж `saveToLocal` решает сам. Прежняя подстановка
  // `options.generation ?? getDraftGeneration(...)` возвращала текущее, то есть
  // всегда «свежее», и защита поколения не отвергала ничего.
  it('не выдумывает поколение, когда вызывающий его не назвал', async () => {
    (WritingDraftService.getDraftGeneration as any).mockReturnValue(7);
    await persistDraft({ userId: 'u1' } as any, { generation: undefined });
    expect(WritingDraftService.saveToLocal).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), undefined);
    expect(WritingDraftService.saveDraftToCloud).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), undefined);
    expect(WritingDraftService.getDraftGeneration).not.toHaveBeenCalled();
  });
});
