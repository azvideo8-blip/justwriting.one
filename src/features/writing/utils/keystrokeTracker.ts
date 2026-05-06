export interface KeystrokeStats {
  kpm: number;
  ikiMedian: number;
  ikiP95: number;
  ikiCv: number;
  sampleSize: number;
}

export class KeystrokeTracker {
  private timestamps: number[] = [];
  private readonly windowMs = 60_000;

  record() {
    const now = performance.now();
    this.timestamps.push(now);
    const cutoff = now - this.windowMs;
    this.timestamps = this.timestamps.filter(t => t >= cutoff);
  }

  getStats(): KeystrokeStats | null {
    if (this.timestamps.length < 10) return null;

    const kpm = (this.timestamps.length / this.windowMs) * 60_000;

    const intervals: number[] = [];
    for (let i = 1; i < this.timestamps.length; i++) {
      const iki = this.timestamps[i] - this.timestamps[i - 1];
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
    this.timestamps = [];
  }
}
