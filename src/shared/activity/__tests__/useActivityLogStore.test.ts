import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useActivityLogStore } from '../useActivityLogStore';

describe('useActivityLogStore (AG-BG-1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useActivityLogStore.getState().clearLog();
  });

  it('adds entries with formatted message and timestamp', () => {
    const store = useActivityLogStore.getState();

    store.addActivity('Note restored', { action: 'test_action' }, 'success', 'test_source');

    const entries = useActivityLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe('Note restored');
    expect(entries[0]?.source).toBe('test_source');
    expect(entries[0]?.count).toBe(1);
    expect(entries[0]?.level).toBe('success');
    expect(entries[0]?.context).toEqual({ action: 'test_action' });
  });

  it('collapses identical entries within 10-second deduplication window', () => {
    const store = useActivityLogStore.getState();

    store.addActivity('Note restored', { action: 'restore' }, 'success', 'cloud');
    vi.advanceTimersByTime(2000);
    store.addActivity('Note restored', { action: 'restore' }, 'success', 'cloud');
    vi.advanceTimersByTime(3000);
    store.addActivity('Note restored', { action: 'restore' }, 'success', 'cloud');

    const entries = useActivityLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.count).toBe(3);

    // After 10s window, a new entry is created
    vi.advanceTimersByTime(11000);
    store.addActivity('Note restored', { action: 'restore' }, 'success', 'cloud');
    expect(useActivityLogStore.getState().entries).toHaveLength(2);
  });

  it('dismisses entry by ID', () => {
    const store = useActivityLogStore.getState();

    store.addActivity('Event 1');
    vi.advanceTimersByTime(11000);
    store.addActivity('Event 2');

    const initial = useActivityLogStore.getState().entries;
    expect(initial).toHaveLength(2);

    const targetId = initial[0]!.id;
    store.dismissEntry(targetId);

    const afterDismiss = useActivityLogStore.getState().entries;
    expect(afterDismiss).toHaveLength(1);
    expect(afterDismiss[0]?.message).toBe('Event 1');
  });

  it('clears log', () => {
    const store = useActivityLogStore.getState();

    store.addActivity('Ev 1');
    store.clearLog();

    expect(useActivityLogStore.getState().entries).toHaveLength(0);
  });

  it('caps memory entries to 200 items', () => {
    const store = useActivityLogStore.getState();

    for (let i = 0; i < 210; i++) {
      vi.advanceTimersByTime(11000);
      store.addActivity(`Event #${i}`);
    }

    expect(useActivityLogStore.getState().entries).toHaveLength(200);
  });
});
