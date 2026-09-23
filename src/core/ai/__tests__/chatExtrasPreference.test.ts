import { describe, it, expect, beforeEach } from 'vitest';
import { getChatExtrasEnabled, setChatExtrasEnabled } from '../chatExtrasPreference';

// EA-18: подсказки и извлечение памяти после ответа — выключаемые служебные запросы.
describe('chat extras preference (EA-18)', () => {
  beforeEach(() => localStorage.clear());

  it('is on by default and per account', () => {
    expect(getChatExtrasEnabled('u1')).toBe(true);
    setChatExtrasEnabled('u1', false);
    expect(getChatExtrasEnabled('u1')).toBe(false);
    expect(getChatExtrasEnabled('u2')).toBe(true);
    setChatExtrasEnabled('u1', true);
    expect(getChatExtrasEnabled('u1')).toBe(true);
  });
});
