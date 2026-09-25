import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { localDayKey, localMonthKey } from '../dateUtils';

// R4-5: день заметки — по местному времени, как у стрика и архива.
describe('R4-5: note days are local, not UTC', () => {
  const tz = process.env.TZ;
  afterEach(() => { process.env.TZ = tz; });

  it('00:30 in Moscow is still that day', () => {
    process.env.TZ = 'Europe/Moscow';
    const d = new Date('2026-08-31T21:30:00Z'); // 1 Sep, 00:30 MSK
    expect(localDayKey(d)).toBe('2026-09-01');
    expect(localMonthKey(d)).toBe('2026-09');
  });

  it('the AI layer does not slice UTC days (budget/quota/file names excepted)', () => {
    // UTC намеренно: дневные квоты сервера и суточные метки фоновых задач.
    const allowed = new Set(['AIBackgroundBudget.ts', 'AIProfileService.ts', 'useDailyLimit.ts', 'useDiagnosticsData.ts', 'useBackgroundSync.ts']);
    const dirs = ['src/features/ai/services', 'src/features/ai/utils', 'src/features/ai/hooks'];
    const offenders = dirs.flatMap(dir => readdirSync(dir)
      .filter(f => /\.tsx?$/.test(f) && !allowed.has(f))
      .filter(f => /toISOString\(\)\.(slice\(0, ?(7|10)\)|split\('T'\)\[0\])/.test(readFileSync(join(dir, f), 'utf8'))));
    expect(offenders).toEqual([]);
  });
});
