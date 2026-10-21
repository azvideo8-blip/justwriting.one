import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { envInt, envPositiveNumber } from '../postgresAiContext';

describe('DA-6: envInt validates integer environment variables against NaN and non-positive numbers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns fallback when variable is undefined or empty', () => {
    delete process.env.TEST_VAR;
    expect(envInt('TEST_VAR', 42)).toBe(42);

    process.env.TEST_VAR = '';
    expect(envInt('TEST_VAR', 42)).toBe(42);
  });

  it('parses valid positive integers', () => {
    process.env.TEST_VAR = '100';
    expect(envInt('TEST_VAR', 42)).toBe(100);

    process.env.TEST_VAR = ' 25000000 ';
    expect(envInt('TEST_VAR', 42)).toBe(25000000);
  });

  it('throws on NaN or invalid strings', () => {
    process.env.TEST_VAR = 'not-a-number';
    expect(() => envInt('TEST_VAR', 42)).toThrow(/Invalid environment variable TEST_VAR="not-a-number"/);

    process.env.TEST_VAR = '100abc';
    expect(() => envInt('TEST_VAR', 42)).toThrow(/Invalid environment variable/);
  });

  it('throws on zero and negative numbers', () => {
    process.env.TEST_VAR = '0';
    expect(() => envInt('TEST_VAR', 42)).toThrow(/must be a positive integer/);

    process.env.TEST_VAR = '-5';
    expect(() => envInt('TEST_VAR', 42)).toThrow(/must be a positive integer/);
  });

  it('throws on floating point numbers', () => {
    process.env.TEST_VAR = '12.34';
    expect(() => envInt('TEST_VAR', 42)).toThrow(/must be a positive integer/);
  });

  it('C-4: рублёвые значения — положительное конечное число, дроби разрешены', () => {
    delete process.env.TEST_RUB;
    expect(envPositiveNumber('TEST_RUB', 30)).toBe(30);

    process.env.TEST_RUB = '12.5';
    expect(envPositiveNumber('TEST_RUB', 30)).toBe(12.5);

    // Пустое — как незаданное (шаблон .env пишет `AI_DAILY_SPEND_LIMIT_RUB=`).
    for (const empty of ['', '  ']) {
      process.env.TEST_RUB = empty;
      expect(envPositiveNumber('TEST_RUB', 30)).toBe(30);
      expect(envPositiveNumber('TEST_RUB', null)).toBeNull();
    }

    for (const bad of ['abc', '-1', '0', 'Infinity', '50 # руб']) {
      process.env.TEST_RUB = bad;
      expect(() => envPositiveNumber('TEST_RUB', 30)).toThrow(/Invalid environment variable TEST_RUB/);
    }
  });
});
