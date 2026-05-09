import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KeystrokeTracker } from '../utils/keystrokeTracker';

describe('KeystrokeTracker', () => {
  let nowMs = 0;

  beforeEach(() => {
    nowMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Helper: record n keystrokes with uniform spacing ─────────────────────

  function recordKeystrokes(tracker: KeystrokeTracker, count: number, intervalMs: number) {
    for (let i = 0; i < count; i++) {
      nowMs += intervalMs;
      tracker.record();
    }
  }

  // ─── Basic null-return guards ─────────────────────────────────────────────

  it('getStats() returns null with < 10 keystrokes', () => {
    const tracker = new KeystrokeTracker();
    recordKeystrokes(tracker, 9, 100);
    expect(tracker.getStats()).toBeNull();
  });

  it('getStats() returns null with < 5 valid intervals (after filtering >2000ms gaps)', () => {
    const tracker = new KeystrokeTracker();
    // Record 10 keystrokes but with gaps > 2000ms so intervals get filtered
    for (let i = 0; i < 10; i++) {
      nowMs += 3000; // 3 seconds gap → filtered out
      tracker.record();
    }
    // 9 intervals, all > 2000ms → 0 valid intervals → null
    expect(tracker.getStats()).toBeNull();
  });

  // ─── KPM calculation ─────────────────────────────────────────────────────

  it('KPM: 60 keystrokes spread over first 60 seconds → ~60 KPM', () => {
    const tracker = new KeystrokeTracker();
    // Start at t=0. Record 60 keystrokes 1 second apart.
    // The tracker window is 60_000ms. All 60 timestamps will be in the window.
    // kpm = (count / windowMs) * 60_000 = (60 / 60000) * 60000 = 60
    recordKeystrokes(tracker, 60, 1000);
    const stats = tracker.getStats();
    expect(stats).not.toBeNull();
    expect(stats!.kpm).toBe(60);
  });

  // ─── Interval filtering ───────────────────────────────────────────────────

  it('intervals > 2000ms are filtered out (thinking pauses)', () => {
    const tracker = new KeystrokeTracker();
    // Record 6 fast keystrokes (100ms apart) then one big gap
    recordKeystrokes(tracker, 6, 100);
    nowMs += 5000; // thinking pause
    tracker.record();
    // Then 5 more fast keystrokes
    recordKeystrokes(tracker, 5, 100);
    // We need at least 10 total keystrokes — we have 12
    const stats = tracker.getStats();
    expect(stats).not.toBeNull();
    // The 5000ms gap should be filtered; sampleSize should exclude it
    // Total intervals = 11, the 5000ms one is excluded → sampleSize = 10
    expect(stats!.sampleSize).toBe(10);
  });

  // ─── Sliding window ───────────────────────────────────────────────────────

  it('keystrokes older than 60s are dropped from the window', () => {
    const tracker = new KeystrokeTracker();
    // Record 15 keystrokes now
    recordKeystrokes(tracker, 15, 100);
    // Jump 61 seconds into the future — all old timestamps fall outside the window
    nowMs += 61_000;
    // Record 1 more to trigger cleanup
    tracker.record();
    // Now only 1 timestamp in the window → < 10 → null
    expect(tracker.getStats()).toBeNull();
  });

  // ─── Statistical properties ───────────────────────────────────────────────

  it('ikiMedian is the middle value of sorted intervals', () => {
    const tracker = new KeystrokeTracker();
    // Create 12 keystrokes with known intervals: 10 at 100ms, 1 at 200ms, 1 at 300ms
    recordKeystrokes(tracker, 10, 100); // intervals: [100, 100, 100, 100, 100, 100, 100, 100, 100]
    nowMs += 200;
    tracker.record(); // interval 200
    nowMs += 300;
    tracker.record(); // interval 300
    // 11 intervals total: nine 100ms + one 200ms + one 300ms
    // sorted: [100,100,100,100,100,100,100,100,100,200,300]
    // median index = floor(11/2) = 5 → value = 100
    const stats = tracker.getStats();
    expect(stats).not.toBeNull();
    expect(stats!.ikiMedian).toBe(100);
  });

  it('ikiP95 is the 95th-percentile interval', () => {
    const tracker = new KeystrokeTracker();
    // 11 keystrokes: 10 intervals of 100ms, 1 interval of 500ms
    recordKeystrokes(tracker, 11, 100); // 10 intervals of 100ms
    nowMs += 500;
    tracker.record(); // 1 interval of 500ms — 11 intervals total
    // sorted: [100,100,100,100,100,100,100,100,100,100,500]
    // p95 index = floor(11 * 0.95) = floor(10.45) = 10 → value = 500
    const stats = tracker.getStats();
    expect(stats).not.toBeNull();
    expect(stats!.ikiP95).toBe(500);
  });

  it('ikiCv = 0 for perfectly uniform typing (all intervals equal)', () => {
    const tracker = new KeystrokeTracker();
    recordKeystrokes(tracker, 20, 200); // all intervals exactly 200ms
    const stats = tracker.getStats();
    expect(stats).not.toBeNull();
    expect(stats!.ikiCv).toBe(0);
  });

  it('ikiCv > 0 for irregular typing', () => {
    const tracker = new KeystrokeTracker();
    // Alternate between 100ms and 500ms gaps
    for (let i = 0; i < 12; i++) {
      nowMs += i % 2 === 0 ? 100 : 500;
      tracker.record();
    }
    const stats = tracker.getStats();
    expect(stats).not.toBeNull();
    expect(stats!.ikiCv).toBeGreaterThan(0);
  });

  // ─── reset() ─────────────────────────────────────────────────────────────

  it('reset() clears all timestamps, getStats() returns null after reset', () => {
    const tracker = new KeystrokeTracker();
    recordKeystrokes(tracker, 20, 100);
    expect(tracker.getStats()).not.toBeNull(); // was healthy
    tracker.reset();
    expect(tracker.getStats()).toBeNull();
  });

  // ─── sampleSize ──────────────────────────────────────────────────────────

  it('sampleSize equals number of valid intervals used', () => {
    const tracker = new KeystrokeTracker();
    // 11 keystrokes → 10 intervals all 100ms → all valid
    recordKeystrokes(tracker, 11, 100);
    const stats = tracker.getStats();
    expect(stats).not.toBeNull();
    expect(stats!.sampleSize).toBe(10);
  });
});
