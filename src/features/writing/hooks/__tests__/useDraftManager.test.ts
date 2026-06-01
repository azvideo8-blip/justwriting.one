import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraftManager } from '../useDraftManager';
import { useTimerStore } from '../../store/useTimerStore';

describe('useDraftManager', () => {
  const userId = 'user_manager_123';
  const dummyDraft = {
    content: 'Draft Content',
    title: 'Draft Title',
    pinnedThoughts: [],
    seconds: 30,
    wpm: 75,
    wordCount: 2,
  };

  const getDraftData = () => dummyDraft;
  const mockOnSaveDraft = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useTimerStore.setState({ status: 'writing' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves draft after 3s leading-edge debounce, then every 30s during writing session', async () => {
    mockOnSaveDraft.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDraftManager(userId, getDraftData, { onSaveDraft: mockOnSaveDraft })
    );

    expect(mockOnSaveDraft).not.toHaveBeenCalled();

    // Leading-edge autosave fires at 3s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(mockOnSaveDraft).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus).toBe('saved');

    // Next interval save fires at 33s (3s + 30s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(mockOnSaveDraft).toHaveBeenCalledTimes(2);
  });

  it('does not save when status is idle', async () => {
    useTimerStore.setState({ status: 'idle' });
    mockOnSaveDraft.mockResolvedValue(undefined);

    renderHook(() =>
      useDraftManager(userId, getDraftData, { onSaveDraft: mockOnSaveDraft })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(mockOnSaveDraft).not.toHaveBeenCalled();
  });

  it('saves draft on visibilitychange to hidden', async () => {
    mockOnSaveDraft.mockResolvedValue(undefined);

    renderHook(() =>
      useDraftManager(userId, getDraftData, { onSaveDraft: mockOnSaveDraft })
    );

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
    
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(mockOnSaveDraft).toHaveBeenCalled();
  });

  it('sets saveStatus to error and saves errorKind quota on QuotaExceededError', async () => {
    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
    mockOnSaveDraft.mockRejectedValue(quotaError);

    const { result } = renderHook(() =>
      useDraftManager(userId, getDraftData, { onSaveDraft: mockOnSaveDraft })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(result.current.saveStatus).toBe('error');
    expect(result.current.saveErrorKind).toBe('quota');
  });

  it('sets saveStatus to error and unknown errorKind on generic error', async () => {
    mockOnSaveDraft.mockRejectedValue(new Error('Unknown save error'));

    const { result } = renderHook(() =>
      useDraftManager(userId, getDraftData, { onSaveDraft: mockOnSaveDraft })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(result.current.saveStatus).toBe('error');
    expect(result.current.saveErrorKind).toBe('unknown');
  });
});
