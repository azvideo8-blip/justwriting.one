import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraftAutosave } from '../useDraftAutosave';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';
import { persistDraft } from '../../utils/draftPersistence';
import type { User } from 'firebase/auth';

vi.mock('../../utils/draftPersistence', () => ({
  buildLocalDraft: vi.fn((user, current) => ({ ...current, userId: user.uid })),
  persistDraft: vi.fn(),
}));

describe('useDraftAutosave', () => {
  const mockUser = { uid: 'user123' } as User;
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

    expect(persistDraft).toHaveBeenCalled();
    expect(result.current.saveStatus).toBe('saved');

    // After 1000ms more it should return to idle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.saveStatus).toBe('idle');
  });

  it('does not save when status is idle', async () => {
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

    expect(persistDraft).not.toHaveBeenCalled();
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

    expect(persistDraft).toHaveBeenCalled();
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
});
