export interface KeystrokeStats {
  kpm: number;
  ikiMedian: number;
  ikiP95: number;
  ikiCv: number;
  sampleSize: number;
}

// [P-02] кольцевой буфер вместо filter(): O(1) при записи вместо O(n)
const RING_SIZE = 1200; // максимум 20 минут при 60 клавишах/сек

export class KeystrokeTracker {
  private ring = new Float64Array(RING_SIZE);
  private head = 0;
  private size = 0;
  private readonly windowMs = 60_000;

  record() {
    const now = performance.now();
    this.ring[this.head] = now;
    this.head = (this.head + 1) % RING_SIZE;
    if (this.size < RING_SIZE) this.size++;
  }

  private getActive(): number[] {
    const now = performance.now();
    const cutoff = now - this.windowMs;
    const result: number[] = [];
    // \u043e\u0431\u0445\u043e\u0434\u0438\u043c \u043a\u043e\u043b\u044c\u0446\u043e \u043e\u0442 \u0441\u0430\u043c\u043e\u0433\u043e \u0441\u0442\u0430\u0440\u043e\u0433\u043e \u043a \u0441\u0430\u043c\u043e\u043c\u0443 \u043d\u043e\u0432\u043e\u043c\u0443
    const start = (this.head - this.size + RING_SIZE) % RING_SIZE;
    for (let i = 0; i < this.size; i++) {
      const t = this.ring[(start + i) % RING_SIZE];
      if (t >= cutoff) result.push(t);
    }
    return result;
  }

  getStats(): KeystrokeStats | null {
    const timestamps = this.getActive();
    if (timestamps.length < 10) return null;

    const kpm = (timestamps.length / this.windowMs) * 60_000;

    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      const iki = timestamps[i] - timestamps[i - 1];
      if (iki < 2000) intervals.push(iki);
    }

    if (intervals.length < 5) return null;

    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    const p95 = intervals[Math.floor(intervals.length * 0.95)];
    const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

    return {
      kpm: Math.round(kpm),
      ikiMedian: Math.round(median),
      ikiP95: Math.round(p95),
      ikiCv: Math.round(cv * 100) / 100,
      sampleSize: intervals.length,
    };
  }

  reset() {
    this.head = 0;
    this.size = 0;
  }
}
