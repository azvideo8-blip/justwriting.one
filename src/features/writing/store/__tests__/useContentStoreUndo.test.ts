import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useContentStore } from '../useContentStore';
import { resetSession, loadDraftIntoStore } from '../storeActions';

describe('useContentStore Undo/Redo (UNDO-1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSession();
  });

  it('coalesces typing bursts into a single undo step', () => {
    const store = useContentStore.getState();

    // Type a word burst
    store.setContent('h', 1);
    store.setContent('he', 2);
    store.setContent('hel', 3);
    store.setContent('hell', 4);
    store.setContent('hello', 5);

    // Before debounce timer, past is empty (burst active)
    expect(useContentStore.getState().past).toHaveLength(0);

    // Advance timers past 500ms debounce
    vi.advanceTimersByTime(600);

    // Burst is now flushed into past
    expect(useContentStore.getState().past).toHaveLength(1);
    expect(useContentStore.getState().past[0]?.content).toBe('');

    // Undo reverts back to empty string
    const res = useContentStore.getState().undo();
    expect(res?.content).toBe('');
    expect(useContentStore.getState().content).toBe('');
    expect(useContentStore.getState().future).toHaveLength(1);

    // Redo restores "hello"
    const redoRes = useContentStore.getState().redo();
    expect(redoRes?.content).toBe('hello');
    expect(useContentStore.getState().content).toBe('hello');
  });

  it('forces a snapshot boundary on newlines', () => {
    const store = useContentStore.getState();

    store.setContent('line 1', 6);
    vi.advanceTimersByTime(600); // flush burst 1

    store.setContent('line 1\n', 7, true); // newline boundary
    store.setContent('line 1\nline 2', 13);
    vi.advanceTimersByTime(600); // flush burst 2

    const undo1 = useContentStore.getState().undo();
    expect(undo1?.content).toBe('line 1\n');

    const undo2 = useContentStore.getState().undo();
    expect(undo2?.content).toBe('line 1');
  });

  it('clears future stack when new edits occur after undo', () => {
    const store = useContentStore.getState();

    store.setContent('first', 5);
    vi.advanceTimersByTime(600);

    store.undo();
    expect(useContentStore.getState().future).toHaveLength(1);

    // Type new text after undo
    store.setContent('second', 6);
    vi.advanceTimersByTime(600);

    expect(useContentStore.getState().future).toHaveLength(0);
  });

  it('resets history on resetSession and loadDraftIntoStore', () => {
    const store = useContentStore.getState();

    store.setContent('note 1 text', 11);
    vi.advanceTimersByTime(600);
    expect(useContentStore.getState().past).toHaveLength(1);

    // Reset session (e.g. starting a new note)
    resetSession();
    expect(useContentStore.getState().past).toHaveLength(0);
    expect(useContentStore.getState().future).toHaveLength(0);

    // Load draft
    useContentStore.getState().setContent('draft content', 13);
    vi.advanceTimersByTime(600);
    loadDraftIntoStore({ content: 'restored draft', title: 'Title', wordCount: 2 });
    expect(useContentStore.getState().past).toHaveLength(0);
    expect(useContentStore.getState().future).toHaveLength(0);
  });
});
