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
});
