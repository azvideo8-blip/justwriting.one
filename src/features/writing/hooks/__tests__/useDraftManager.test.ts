import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { renderHook, act } from '@testing-library/react';
import { useDraftManager } from '../useDraftManager';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';
import { clearEditorTextOwner, markEditorTextOwner } from '../../services/draftWriter';

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
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('user_manager_123'), 'true'); // D-22: эти тесты проверяют облачную запись
    vi.clearAllMocks();
    vi.useFakeTimers();
    useTimerStore.setState({ status: 'writing' });
    useContentStore.setState({ content: '', title: '' });
    // DW4-4: зеркало владельца модульное — чистим между тестами.
    clearEditorTextOwner();
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

  it('autosaves after 1s debounce when content is present even if timer status is idle (S-8)', async () => {
    useTimerStore.setState({ status: 'idle' });
    useContentStore.setState({ content: 'Pasted text without keydown' });
    mockOnSaveDraft.mockResolvedValue(undefined);

    renderHook(() =>
      useDraftManager(userId, getDraftData, { onSaveDraft: mockOnSaveDraft })
    );

    expect(mockOnSaveDraft).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockOnSaveDraft).toHaveBeenCalledTimes(1);
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

    expect(mockOnSaveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Draft Content',
        title: 'Draft Title',
        wordCount: 2,
      }),
      // Второй аргумент — эпоха на момент правки (DW4-2): писатель называет её.
      expect.any(Number)
    );
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

  it('RC-3: 30s autosave interval survives keystrokes during continuous typing in useDraftManager', async () => {
    mockOnSaveDraft.mockResolvedValue(undefined);

    useContentStore.setState({ content: '', title: '' });
    renderHook(() =>
      useDraftManager(userId, getDraftData, { onSaveDraft: mockOnSaveDraft })
    );

    expect(mockOnSaveDraft).not.toHaveBeenCalled();

    // Type every 500ms for 45s (90 steps)
    for (let i = 1; i <= 90; i++) {
      await act(async () => {
        useContentStore.setState({ content: 'а'.repeat(i) });
        await vi.advanceTimersByTimeAsync(500);
      });
      if (i === 66) {
        // At 33 seconds, 30s autosave must have fired at least once
        expect(mockOnSaveDraft).toHaveBeenCalled();
      }
    }

    expect(mockOnSaveDraft).toHaveBeenCalled();
  });

  // N-47: после выхода из аккаунта редактор гостя получает тот же стор текста —
  // текст аккаунта гостю не показывается и гостевым черновиком не сохраняется.
  it('the guest editor drops text that belongs to an account', () => {
    useContentStore.setState({ content: 'Текст аккаунта', title: 'T'});
    markEditorTextOwner('acc-1');
    renderHook(() => useDraftManager('guest_x', getDraftData, { onSaveDraft: mockOnSaveDraft }));
    expect(useContentStore.getState().content).toBe('');
  });

  it('the guest editor keeps its own (ownerless) text', () => {
    useContentStore.setState({ content: 'Гостевой текст', title: 'T'});
    renderHook(() => useDraftManager('guest_x', getDraftData, { onSaveDraft: mockOnSaveDraft }));
    expect(useContentStore.getState().content).toBe('Гостевой текст');
  });

  it('N-73 (a): pristine continued session returns SKIPPED and leaves saveStatus idle (not saved)', async () => {
    const { useSessionMetaStore } = await import('../../store/useSessionMetaStore');
    useSessionMetaStore.setState({
      savedDocumentId: 'doc_cont_1',
      loadedContent: 'Draft Content',
      loadedTitle: 'Draft Title',
    });

    const { result } = renderHook(() =>
      useDraftManager(userId, getDraftData, { onSaveDraft: mockOnSaveDraft })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(mockOnSaveDraft).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe('idle');
  });
});
