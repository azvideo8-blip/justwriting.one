import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseOpenRange, parseTemporalQuery } from '../temporalQueryParser';

// Стенд ai-memory-base-fable-2026-11 (Q19/Q20): «с июня» срезалось до одного
// июня, «с лета до октября» — до одного октября.
const NOW = new Date(2026, 9, 7, 12);

describe('parseOpenRange', () => {
  it('«с июня» — от начала июня до сегодня', () => {
    expect(parseOpenRange('как с июня менялись мои мысли об отъезде', NOW)).toEqual({ from: '2026-06-01', to: '2026-10-07' });
  });
  it('«с лета до октября» — три сезона назад до конца месяца, но не позже сегодня', () => {
    expect(parseOpenRange('как с лета до октября менялись отношения с романом', NOW)).toEqual({ from: '2026-06-01', to: '2026-10-07' });
  });
  it('«за осень» — время года целиком, обрезанное сегодняшним днём', () => {
    expect(parseOpenRange('как менялось моё отношение за осень', NOW)).toEqual({ from: '2026-09-01', to: '2026-10-07' });
    expect(parseOpenRange('что было за зиму', NOW)).toEqual({ from: '2025-12-01', to: '2026-02-28' });
  });
  it('период через границу года и с названным годом', () => {
    expect(parseOpenRange('с ноября до марта что было', NOW)).toEqual({ from: '2025-11-01', to: '2026-03-31' });
    expect(parseOpenRange('с мая 2025 по август 2025', NOW)).toEqual({ from: '2025-05-01', to: '2025-08-31' });
    // конец периода — время года: берётся его последний месяц, а не первый
    expect(parseOpenRange('что было с января до весны', NOW)).toEqual({ from: '2026-01-01', to: '2026-05-31' });
  });
  it('период, конец которого ещё не наступил, без года — прошлый такой период (ревью 0.11.10)', () => {
    const NOV = new Date(2026, 10, 11, 12);
    expect(parseOpenRange('что было с ноября до марта', NOV)).toEqual({ from: '2025-11-01', to: '2026-03-31' });
    expect(parseOpenRange('как менялось с осени до весны', NOV)).toEqual({ from: '2025-09-01', to: '2026-05-31' });
    // конец уже начался — текущий период, как раньше
    expect(parseOpenRange('как с лета до октября менялись отношения с романом', NOW)).toEqual({ from: '2026-06-01', to: '2026-10-07' });
  });
  it('не период: «с мамой», «с летом в душе», дни месяца', () => {
    expect(parseOpenRange('поговорила с мамой', NOW)).toBeNull();
    expect(parseOpenRange('иду с летом в душе', NOW)).toBeNull();
    // Ревью 0.11.10: «с лету» — оборот, а не «с лета».
    expect(parseOpenRange('я с лету понял, что писал про переезд', NOW)).toBeNull();
    expect(parseOpenRange('с 10 октября по 24 октября', NOW)).toBeNull();
  });
});

describe('parseTemporalQuery — открытый период', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('отдаёт dateRange, а не один месяц', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW.getTime() });
    expect(parseTemporalQuery('как с июня менялись мои мысли об отъезде из города?')).toMatchObject({ type: 'dateRange', from: '2026-06-01', to: '2026-10-07' });
    // прежнее поведение точных дат не тронуто
    expect(parseTemporalQuery('что было с 10 октября по 24 октября')).toMatchObject({ type: 'dateRange', from: '2026-10-10' });
    expect(parseTemporalQuery('что я писала в июне')).toMatchObject({ type: 'month', month: '2026-06' });
  });
});
