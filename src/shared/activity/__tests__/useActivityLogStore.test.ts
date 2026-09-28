import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useActivityLogStore, scrubMessage } from '../useActivityLogStore';

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

  it('updates an existing entry via updateEntry', () => {
    const store = useActivityLogStore.getState();
    const id = store.addActivity('Initial event', { foo: 'bar' });

    store.updateEntry(id, { count: 5, message: 'Updated event' });

    const entries = useActivityLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(id);
    expect(entries[0]?.count).toBe(5);
    expect(entries[0]?.message).toBe('Updated event');
    expect(entries[0]?.context).toEqual({ foo: 'bar' });
  });

  describe('AG-PRIV-A: activity log scrubbing', () => {
    it('scrubs long quoted strings and base64 payloads from error messages', () => {
      const store = useActivityLogStore.getState();
      const longNote = 'Сессия психотерапии от 15 августа: сильная тревога по поводу работы и отношений с родителями';
      const base64Data = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=';
      const rawError = new Error(`Validation failed for "${longNote}" with cipher: ${base64Data}`);

      store.addActivity(rawError);

      const entries = useActivityLogStore.getState().entries;
      expect(entries).toHaveLength(1);
      const msg = entries[0]!.message;
      expect(msg).not.toContain(longNote);
      expect(msg).toContain('…');
      expect(msg).not.toContain(base64Data);
      expect(msg).toContain('[data]');
      expect(msg.length).toBeLessThanOrEqual(200);
    });

    it('does not stringify arbitrary objects with JSON.stringify', () => {
      const store = useActivityLogStore.getState();
      const rawObject = {
        secretNote: 'Мой секретный дневник, который не должен попасть в localStorage',
        code: 'ERR_SYNC_FAIL',
      };

      store.addActivity(rawObject);

      const entries = useActivityLogStore.getState().entries;
      expect(entries).toHaveLength(1);
      const msg = entries[0]!.message;
      expect(msg).not.toContain('Мой секретный дневник');
      expect(msg).toContain('Object (ERR_SYNC_FAIL)');
      expect(msg.length).toBeLessThanOrEqual(200);
    });

    it('leaves standard short error messages intact without over-scrubbing', () => {
      const store = useActivityLogStore.getState();
      store.addActivity(new Error('Cloud unavailable'));

      const entries = useActivityLogStore.getState().entries;
      expect(entries).toHaveLength(1);
      expect(entries[0]?.message).toBe('Cloud unavailable');
    });

    it('F-027: scrubs long quoted strings for double, single, and guillemet quotes', () => {
      const longText = 'Это очень длинный текст дневниковой записи';
      expect(scrubMessage(`Error in "${longText}" during save`)).toBe('Error in "…" during save');
      expect(scrubMessage(`Error in '${longText}' during save`)).toBe("Error in '…' during save");
      expect(scrubMessage(`Error in «${longText}» during save`)).toBe('Error in «…» during save');
    });
  });
});
