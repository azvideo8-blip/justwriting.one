import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useErrorLogStore } from '../useErrorLogStore';

describe('useErrorLogStore (ERR-1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useErrorLogStore.getState().clearLog();
  });

  it('adds error entries with formatted message and timestamp', () => {
    const store = useErrorLogStore.getState();

    store.addError(new Error('Test failure'), { action: 'test_action' }, 'error', 'test_source');

    const entries = useErrorLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe('Test failure');
    expect(entries[0]?.source).toBe('test_source');
    expect(entries[0]?.count).toBe(1);
    expect(entries[0]?.context).toEqual({ action: 'test_action' });
  });

  it('collapses identical errors within 10-second deduplication window', () => {
    const store = useErrorLogStore.getState();

    store.addError('Network timeout', { action: 'fetch_data' }, 'error', 'fetch');
    vi.advanceTimersByTime(2000);
    store.addError('Network timeout', { action: 'fetch_data' }, 'error', 'fetch');
    vi.advanceTimersByTime(3000);
    store.addError('Network timeout', { action: 'fetch_data' }, 'error', 'fetch');

    const entries = useErrorLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.count).toBe(3);

    // After 10s window, a new entry is created
    vi.advanceTimersByTime(11000);
    store.addError('Network timeout', { action: 'fetch_data' }, 'error', 'fetch');
    expect(useErrorLogStore.getState().entries).toHaveLength(2);
  });

  it('dismisses entry by ID', () => {
    const store = useErrorLogStore.getState();

    store.addError('Error 1');
    vi.advanceTimersByTime(11000);
    store.addError('Error 2');

    const initial = useErrorLogStore.getState().entries;
    expect(initial).toHaveLength(2);

    const targetId = initial[0]!.id;
    store.dismissEntry(targetId);

    const afterDismiss = useErrorLogStore.getState().entries;
    expect(afterDismiss).toHaveLength(1);
    expect(afterDismiss[0]?.message).toBe('Error 1');
  });

  it('clears log', () => {
    const store = useErrorLogStore.getState();

    store.addError('Err 1');
    store.clearLog();

    expect(useErrorLogStore.getState().entries).toHaveLength(0);
  });

  it('caps memory entries to 50 items', () => {
    const store = useErrorLogStore.getState();

    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(11000);
      store.addError(`Error #${i}`);
    }

    expect(useErrorLogStore.getState().entries).toHaveLength(50);
  });
});
