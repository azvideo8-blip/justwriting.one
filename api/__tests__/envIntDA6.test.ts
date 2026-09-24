import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { envInt } from '../postgresAiContext';

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
});
