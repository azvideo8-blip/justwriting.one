// AUDIT-M12: повреждённая запись квоты в localStorage не должна приниматься.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = vi.hoisted(() => {
  const backing = new Map<string, string>();
  return {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => void backing.clear(),
    _backing: backing,
  };
});

vi.stubGlobal('localStorage', store);
// window/document нужны для armMidnightReset-блока — глушим, чтобы он не стартовал.
vi.stubGlobal('document', { addEventListener: () => {}, hidden: true });
vi.stubGlobal('window', {});

import { useAiLimitStore } from '../useAiLimitStore';

describe('AUDIT-M12 local usage validation', () => {
  beforeEach(() => {
    store._backing.delete('ai_daily_usage');
  });

  it('accepts a valid record', () => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem('ai_daily_usage', JSON.stringify({ count: 5, date: today }));
    useAiLimitStore.getState().loadLimit();
    expect(useAiLimitStore.getState().used).toBe(5);
  });

  it('rejects corrupted records instead of trusting them', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const bad of [
      JSON.stringify({ count: '999999', date: today }), // count не число
      JSON.stringify({ count: -3, date: today }),       // отрицательный
      JSON.stringify({ count: 1.5, date: today }),      // дробный
      JSON.stringify({ count: 5, date: 'not-a-date' }), // дата не по форме
      '{broken json',
    ]) {
      localStorage.setItem('ai_daily_usage', bad);
      useAiLimitStore.getState().loadLimit();
      expect(useAiLimitStore.getState().used).toBe(0);
    }
  });
});
