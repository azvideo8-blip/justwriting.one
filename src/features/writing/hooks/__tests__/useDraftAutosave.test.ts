import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraftAutosave } from '../useDraftAutosave';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { persistDraft } from '../../utils/draftPersistence';
import type { AppUser } from '../../../../core/auth/types';

vi.mock('../../utils/draftPersistence', () => ({
  buildLocalDraft: vi.fn((user, current) => ({ ...current, userId: user.uid })),
  persistDraft: vi.fn(),
}));

describe('useDraftAutosave', () => {
  const mockUser = { uid: 'user123' } as AppUser;
  const initialData = {
    title: 'Autosave Title',
    content: 'Some draft text',
    pinnedThoughts: [],
    seconds: 10,
    wpm: 60,
    wordCount: 3,
    status: 'writing' as const,
    activeSessionId: 'sess_123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useTimerStore.setState({ status: 'writing' });
    useContentStore.setState({ content: '', title: '', wordCount: 0 });
    useSessionMetaStore.getState().resetSessionMetadata();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves draft after 500ms debounce on content changes', async () => {
    vi.mocked(persistDraft).mockResolvedValue({ localOk: true, remoteOk: true });

    const { result, rerender } = renderHook(
      ({ data }) => useDraftAutosave(mockUser, data),
      { initialProps: { data: initialData } }
    );

    expect(result.current.saveStatus).toBe('idle');

    // Trigger change
    const updatedData = { ...initialData, content: 'Some draft text changed', wordCount: 4 };
    rerender({ data: updatedData });

    // Status should update to saving/saved after timers run
    await act(async () => {
      await vi.advanceTimersByTimeAsync(510);
    });

    expect(persistDraft).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Some draft text changed', wordCount: 4 }),
      { remote: false }
    );
    expect(result.current.saveStatus).toBe('saved');

    // After 1000ms more it should return to idle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.saveStatus).toBe('idle');
  });

  it('saves draft even when status is idle if content is present (S-8)', async () => {
    vi.mocked(persistDraft).mockResolvedValue({ localOk: true, remoteOk: true });
    useTimerStore.setState({ status: 'idle' });
    const idleData = { ...initialData, status: 'idle' as const };

    const { rerender } = renderHook(
      ({ data }) => useDraftAutosave(mockUser, data),
      { initialProps: { data: idleData } }
    );

    rerender({ data: { ...idleData, content: 'changed text' } });
    
    await act(async () => {
      await vi.advanceTimersByTimeAsync(510);
    });

    expect(persistDraft).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'changed text' }),
      { remote: false }
    );
  });

  it('saves on visibilitychange hidden', async () => {
    vi.mocked(persistDraft).mockResolvedValue({ localOk: true, remoteOk: true });

    renderHook(() => useDraftAutosave(mockUser, initialData));

    // Simulate visibility change
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
    
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(persistDraft).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Some draft text', title: 'Autosave Title' }),
      { remote: true }
    );
  });

  it('reports error on save failure', async () => {
    vi.mocked(persistDraft).mockRejectedValue(new Error('Write failed'));

    const { result, rerender } = renderHook(
      ({ data }) => useDraftAutosave(mockUser, data),
      { initialProps: { data: initialData } }
    );

    rerender({ data: { ...initialData, content: 'trigger save' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(510);
    });

    expect(result.current.saveStatus).toBe('error');
    expect(result.current.saveErrorKind).toBe('unknown');
  });

  it('reports quota errorKind on QuotaExceededError save failure', async () => {
    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
    vi.mocked(persistDraft).mockRejectedValue(quotaError);

    const { result, rerender } = renderHook(
      ({ data }) => useDraftAutosave(mockUser, data),
      { initialProps: { data: initialData } }
    );

    rerender({ data: { ...initialData, content: 'trigger save' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(510);
    });

    expect(result.current.saveStatus).toBe('error');
    expect(result.current.saveErrorKind).toBe('quota');
  });

  it('reports warning and error status on quota exceeded error', async () => {
    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
    vi.mocked(persistDraft).mockRejectedValue(quotaError);

    const { result, rerender } = renderHook(
      ({ data }) => useDraftAutosave(mockUser, data),
      { initialProps: { data: initialData } }
    );

    rerender({ data: { ...initialData, content: 'trigger save' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(510);
    });

    expect(result.current.saveStatus).toBe('error');
  });

  /**
   * Mirrors production: a local-only save reports remoteOk=true because no
   * remote save was attempted (`!shouldRemoteSave || ...` in draftPersistence).
   * Mocking persistDraft flat makes the local path masquerade as a remote one,
   * which hides both regressions covered below.
   */
  function mockPersistByMode(remoteError?: unknown) {
    vi.mocked(persistDraft).mockImplementation(async (_draft, options) => {
      if (!(options?.remote ?? true)) return { localOk: true, remoteOk: true };
      return { localOk: true, remoteOk: false, remoteError };
    });
  }

  it('sets status to cloud-stale after 3 consecutive remote failures', async () => {
    mockPersistByMode();

    const { result } = renderHook(() => useDraftAutosave(mockUser, initialData));

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(result.current.saveStatus).toBe('saved'); // < 3 failures

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(result.current.saveStatus).toBe('saved');

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(result.current.saveStatus).toBe('cloud-stale');
  });

  it('a local-only autosave between remote failures does not reset the count', async () => {
    mockPersistByMode();

    const { result, rerender } = renderHook(
      ({ data }) => useDraftAutosave(mockUser, data),
      { initialProps: { data: initialData } }
    );

    // The real pattern: the user keeps typing, so the debounced local save
    // fires between the 30s remote attempts.
    for (let i = 0; i < 3; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      rerender({ data: { ...initialData, content: `typing ${i}`, wordCount: 3 + i } });
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    }

    expect(result.current.saveStatus).toBe('cloud-stale');
  });

  it('resets remote fail count on success', async () => {
    vi.mocked(persistDraft)
      .mockResolvedValueOnce({ localOk: true, remoteOk: false })
      .mockResolvedValueOnce({ localOk: true, remoteOk: false })
      .mockResolvedValueOnce({ localOk: true, remoteOk: true });

    const { result } = renderHook(() => useDraftAutosave(mockUser, initialData));

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });

    // 3rd attempt is success
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(result.current.saveStatus).toBe('saved');
  });

  it('immediately sets cloud-stale on permanent error and stops the interval', async () => {
    mockPersistByMode({ code: 'permission-denied' });

    const { result } = renderHook(() => useDraftAutosave(mockUser, initialData));

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(result.current.saveStatus).toBe('cloud-stale');

    vi.mocked(persistDraft).mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(persistDraft).not.toHaveBeenCalled();
  });

  it('immediately sets cloud-stale on Postgres check constraint violation (23514)', async () => {
    mockPersistByMode({ code: '23514', message: 'new row for relation "drafts" violates check constraint "drafts_title_check"' });

    const { result } = renderHook(() => useDraftAutosave(mockUser, initialData));

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(result.current.saveStatus).toBe('cloud-stale');

    vi.mocked(persistDraft).mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(persistDraft).not.toHaveBeenCalled();
  });

  it('immediately sets cloud-stale on HTTP 400 Bad Request', async () => {
    mockPersistByMode({ status: 400, message: 'violates check constraint' });

    const { result } = renderHook(() => useDraftAutosave(mockUser, initialData));

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(result.current.saveStatus).toBe('cloud-stale');

    vi.mocked(persistDraft).mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(persistDraft).not.toHaveBeenCalled();
  });

  it('keeps warning instead of reverting to "saved" once the cloud is known stale', async () => {
    mockPersistByMode({ code: 'permission-denied' });

    const { result, rerender } = renderHook(
      ({ data }) => useDraftAutosave(mockUser, data),
      { initialProps: { data: initialData } }
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(result.current.saveStatus).toBe('cloud-stale');

    // The user writes on. The cloud copy is still stale and — because the
    // interval was stopped — will not be retried, so the indicator must not
    // go back to claiming everything is saved.
    rerender({ data: { ...initialData, content: 'still writing' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.saveStatus).toBe('cloud-stale');
  });

  it('does not let the stale warning fade out on its own', async () => {
    mockPersistByMode({ code: 'permission-denied' });

    const { result } = renderHook(() => useDraftAutosave(mockUser, initialData));

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(result.current.saveStatus).toBe('cloud-stale');

    // The user stops typing: no local save, and the remote interval is stopped.
    // Nothing will re-assert the warning, so it must not time out to a blank
    // indicator — that reads as "all good" while the cloud copy is stale.
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(result.current.saveStatus).toBe('cloud-stale');
  });

  it('RC-3: 30s remote autosave interval survives keystrokes during continuous typing', async () => {
    vi.mocked(persistDraft).mockResolvedValue({ localOk: true, remoteOk: true });

    let currentDraft = { ...initialData, content: '', title: '' };
    const { rerender } = renderHook(
      ({ data }) => useDraftAutosave(mockUser, data),
      { initialProps: { data: currentDraft } }
    );

    let remoteSaves = 0;
    vi.mocked(persistDraft).mockImplementation(async (_draft, opts) => {
      if (opts?.remote === true) remoteSaves++;
      return { localOk: true, remoteOk: true };
    });

    // Type every 500ms for 45 seconds (90 steps)
    for (let i = 1; i <= 90; i++) {
      currentDraft = { ...currentDraft, content: 'а'.repeat(i), wordCount: 1 };
      rerender({ data: currentDraft });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      if (i === 62) {
        // At 31 seconds, remote autosave must have fired at least once
        expect(remoteSaves).toBeGreaterThanOrEqual(1);
      }
    }

    expect(remoteSaves).toBeGreaterThanOrEqual(1);
  });

  describe('D-24: Pristine continued note draft suppression', () => {
    it('does not save draft when continuing note without edits', async () => {
      vi.mocked(persistDraft).mockResolvedValue({ localOk: true, remoteOk: true });

      useSessionMetaStore.setState({
        savedDocumentId: 'doc_existing_123',
        loadedContent: 'Original loaded note body',
        loadedTitle: 'Original Note Title',
      });

      const pristineData = {
        title: 'Original Note Title',
        content: 'Original loaded note body',
        pinnedThoughts: [],
        seconds: 0,
        wpm: 0,
        wordCount: 4,
        status: 'writing' as const,
        activeSessionId: null,
      };

      renderHook(() => useDraftAutosave(mockUser, pristineData));

      // Advance past debounce (500ms) and past remote interval (30s)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(35_000);
      });

      expect(persistDraft).not.toHaveBeenCalled();
    });

    it('saves draft once text or title differs from loaded version', async () => {
      vi.mocked(persistDraft).mockResolvedValue({ localOk: true, remoteOk: true });

      useSessionMetaStore.setState({
        savedDocumentId: 'doc_existing_123',
        loadedContent: 'Original loaded note body',
        loadedTitle: 'Original Note Title',
      });

      const pristineData = {
        title: 'Original Note Title',
        content: 'Original loaded note body',
        pinnedThoughts: [],
        seconds: 0,
        wpm: 0,
        wordCount: 4,
        status: 'writing' as const,
        activeSessionId: null,
      };

      const { rerender } = renderHook(
        ({ data }) => useDraftAutosave(mockUser, data),
        { initialProps: { data: pristineData } }
      );

      // Verify no save initially
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(persistDraft).not.toHaveBeenCalled();

      // User types one character
      const editedData = {
        ...pristineData,
        content: 'Original loaded note body!',
      };
      rerender({ data: editedData });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(persistDraft).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Original loaded note body!' }),
        { remote: false }
      );
    });
  });

  // Аккаунт сменился под открытым редактором (ссылка-приглашение поверх своей
  // сессии): текст прежнего аккаунта уходил черновиком нового — и в его облако.
  it('an account switch keeps the text with its owner and never saves it as the new account', async () => {
    vi.mocked(persistDraft).mockResolvedValue({ localOk: true, remoteOk: true });
    const ownerA = { uid: 'owner-A' } as AppUser;
    const inviteeB = { uid: 'invitee-B' } as AppUser;
    useContentStore.setState({ content: 'Личный текст A', title: 'A', wordCount: 3 });
    const aData = { ...initialData, content: 'Личный текст A', title: 'A' };

    const { rerender } = renderHook(
      ({ user, data }) => useDraftAutosave(user, data),
      { initialProps: { user: ownerA, data: aData } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    vi.mocked(persistDraft).mockClear();

    rerender({ user: inviteeB, data: aData }); // сессия уже B, в сторе ещё текст A
    const c = useContentStore.getState();
    rerender({ user: inviteeB, data: { ...aData, content: c.content, title: c.title } });
    await act(async () => { await vi.advanceTimersByTimeAsync(35_000); });

    const calls = vi.mocked(persistDraft).mock.calls.map(([d, o]) => ({ ...(d as { userId: string; content: string }), ...o }));
    expect(calls.filter(d => d.userId === 'invitee-B' && d.content.includes('Личный текст A'))).toEqual([]);
    expect(calls).toContainEqual(expect.objectContaining({ userId: 'owner-A', content: 'Личный текст A', remote: false }));
    expect(useContentStore.getState().content).toBe('');
  });
});
