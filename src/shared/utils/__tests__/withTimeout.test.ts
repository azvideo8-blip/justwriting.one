import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout, TimeoutError } from '../withTimeout';

afterEach(() => {
  vi.restoreAllMocks();
});

// N4: withTimeout used to reject with a plain Error('Timeout') —
// indistinguishable from any other error. TimeoutError carries isTimeout=true
// so mapAIError can tell 'we didn't wait' from 'the server broke'.
describe('withTimeout', () => {
  it('rejects with TimeoutError when the timeout fires', async () => {
    vi.useFakeTimers();
    const slow = new Promise(() => {}); // never settles
    const p = withTimeout(slow, 1000);

    vi.advanceTimersByTime(1000);

    await expect(p).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(TimeoutError);
      expect((e as TimeoutError).isTimeout).toBe(true);
      expect((e as TimeoutError).message).toBe('Timeout');
      return true;
    });

    vi.useRealTimers();
  });

  it('uses the default message "Timeout" when none is given', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 500);
    vi.advanceTimersByTime(500);

    await expect(p).rejects.toSatisfy((e: unknown) => {
      expect((e as TimeoutError).message).toBe('Timeout');
      return true;
    });

    vi.useRealTimers();
  });

  it('passes a custom message through to TimeoutError', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 500, 'Too slow');
    vi.advanceTimersByTime(500);

    await expect(p).rejects.toSatisfy((e: unknown) => {
      expect((e as TimeoutError).message).toBe('Too slow');
      return true;
    });

    vi.useRealTimers();
  });

  it('resolves normally when the promise settles before the timeout', async () => {
    vi.useFakeTimers();
    const fast = Promise.resolve('ok');
    const p = withTimeout(fast, 5000);

    // Advance past any microtask processing.
    await vi.advanceTimersByTimeAsync(0);

    await expect(p).resolves.toBe('ok');
    vi.useRealTimers();
  });

  it('does not leave a hanging rejection when the promise wins the race', async () => {
    vi.useFakeTimers();
    const fast = Promise.resolve(42);
    const p = withTimeout(fast, 100);

    await vi.advanceTimersByTimeAsync(0);
    await expect(p).resolves.toBe(42);

    // Advance past the timeout — the timer was cleared, so no rejection fires.
    vi.advanceTimersByTime(200);
    // If a hanging rejection existed, this test would fail with unhandled rejection.
    vi.useRealTimers();
  });
});
