// Приёмка DW-6, ревьюер 04.11: постраничный повтор живёт внутри внешнего. Без правила
// стойкий 429 давал 6×6 = 36 попыток с паузой до 16 с — окно минут на десять.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rateLimitTuning, withRateLimitRetry } from '../rateGate';

const saved = { ...rateLimitTuning };
beforeEach(() => { rateLimitTuning.baseMs = 1; rateLimitTuning.maxMs = 1; });
afterEach(() => { Object.assign(rateLimitTuning, saved); });

const limited = () => Object.assign(new Error('Too Many Requests'), { code: '429' });

describe('rateGate: вложенный повтор', () => {
  it('внутренний исчерпал попытки: внешний не начинает их заново', async () => {
    let calls = 0;
    const inner = () => withRateLimitRetry(async () => { calls++; throw limited(); });
    await expect(withRateLimitRetry(inner)).rejects.toThrow(/Too Many/);
    expect(calls).toBe(rateLimitTuning.maxAttempts);
  });

  it('контроль: один уровень повторяет, пока не пройдёт', async () => {
    let calls = 0;
    const got = await withRateLimitRetry(async () => {
      if (++calls < 3) throw limited();
      return 'ok';
    });
    expect(got).toBe('ok');
    expect(calls).toBe(3);
  });

  it('дейлик 05.11 К-1: удача соседа между двумя 429 не сбрасывает рост паузы', async () => {
    vi.resetModules();
    const gate = await import('../rateGate');
    gate.rateLimitTuning.baseMs = 40;
    gate.rateLimitTuning.maxMs = 400;
    // Первый гейт — с темпом загрузки модуля (2 с): за ним тишина, и темп становится базовым.
    const limitedOnce = () => gate.withRateLimitRetry(async () => { throw limited(); }, 1);
    await expect(limitedOnce()).rejects.toThrow(/Too Many/);
    await gate.withRateLimitRetry(async () => 'сосед прошёл', 1);
    await expect(limitedOnce()).rejects.toThrow(/Too Many/);
    await gate.withRateLimitRetry(async () => 'сосед прошёл', 1);
    await expect(limitedOnce()).rejects.toThrow(/Too Many/);
    const t = Date.now();
    await gate.withRateLimitRetry(async () => 'ждём гейт', 1);
    expect(Date.now() - t, 'пауза не выросла').toBeGreaterThanOrEqual(70);
  }, 40_000);
});
