import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChaosBrowser, ChaosDevice } from '../chaosBrowser';
import { InMemoryPostgres } from '../inMemoryPostgres';

const nativeTimeout = globalThis.setTimeout;

describe('chaos browser isolation', () => {
  let browser: ChaosBrowser;
  beforeEach(() => {
    browser = new ChaosBrowser();
    browser.fallback = browser.createTab(new ChaosDevice('A'));
    browser.install();
  });
  afterEach(() => { browser.close(); vi.restoreAllMocks(); });

  it('a delayed callback keeps its originating storage, network and clock', async () => {
    const a = browser.fallback!;
    const b = browser.createTab(new ChaosDevice('B'));
    a.device.offline = true;
    a.device.skew = -600_000;
    const done = a.run(() => new Promise<void>(resolve => {
      setTimeout(() => {
        localStorage.setItem('owner', 'A');
        expect(navigator.onLine).toBe(false);
        expect(Date.now()).toBeLessThan(browser.serverNow() - 599_000);
        resolve();
      }, 1);
    }));
    browser.fallback = b;
    b.run(() => localStorage.setItem('owner', 'B'));
    await done;
    expect(a.device.storage.get('owner')).toBe('A');
    expect(b.device.storage.get('owner')).toBe('B');
  });

  it('tabs share persistent storage but not session storage or window events', () => {
    const first = browser.fallback!;
    const second = browser.createTab(first.device);
    const listener = vi.fn();
    first.run(() => {
      localStorage.setItem('durable', 'text');
      sessionStorage.setItem('private', 'first');
      window.addEventListener('test-event', listener);
    });
    second.run(() => {
      expect(localStorage.getItem('durable')).toBe('text');
      expect(sessionStorage.getItem('private')).toBeNull();
      window.dispatchEvent(new Event('test-event'));
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it('termination cancels callbacks, retains storage and releases only owned browser locks', async () => {
    const first = browser.fallback!;
    const second = browser.createTab(first.device);
    const unrelated = browser.createTab(new ChaosDevice('B'));
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const callback = vi.fn();
    first.run(() => {
      localStorage.setItem('durable', 'text');
      setTimeout(callback, 5);
      void navigator.locks.request('pull', () => { entered(); return new Promise<void>(() => {}); });
    });
    await ready;
    let secondEntered = false;
    const next = second.run(() => navigator.locks.request('pull', () => { secondEntered = true; }));
    await unrelated.run(() => navigator.locks.request('pull', () => {}));
    expect(secondEntered).toBe(false);
    first.close();
    await next;
    await new Promise(resolve => nativeTimeout(resolve, 10));
    expect(callback).not.toHaveBeenCalled();
    expect(secondEntered).toBe(true);
    expect(first.device.storage.get('durable')).toBe('text');
  });

  it('server timestamps do not follow a device clock correction', () => {
    const pg = new InMemoryPostgres();
    pg.serverNow = browser.serverNow;
    const now = browser.serverNow();
    browser.fallback!.device.skew = -600_000;
    pg.executeInsert('documents', { uuid: 'synthetic', user_id: 'test' });
    const stamp = Date.parse(String(pg.getRows('documents')[0]!.updated_at));
    expect(stamp).toBeGreaterThanOrEqual(now);
    expect(stamp - Date.now()).toBeGreaterThan(599_000);
  });
});

it('a ten-minute backwards clock correction delays the 429 gate but it eventually recovers', async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  try {
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    const { withRateLimitRetry } = await import('../../../core/services/rateGate');
    const error = { code: '429', message: 'Too many requests' };
    await expect(withRateLimitRetry(() => Promise.reject(error), 1)).rejects.toBe(error);
    vi.setSystemTime(now - 600_000);
    const request = vi.fn().mockResolvedValue('recovered');
    const pending = withRateLimitRetry(request);
    await vi.advanceTimersByTimeAsync(601_999);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe('recovered');
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
