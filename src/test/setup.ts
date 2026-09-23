import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { vi } from 'vitest';

if (!process.env.VITE_SUPABASE_URL) {
  process.env.VITE_SUPABASE_URL = 'https://mock.supabase.co';
}
if (!process.env.VITE_SUPABASE_ANON_KEY) {
  process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key';
}
if (!import.meta.env.VITE_SUPABASE_URL) {
  import.meta.env.VITE_SUPABASE_URL = 'https://mock.supabase.co';
}
if (!import.meta.env.VITE_SUPABASE_ANON_KEY) {
  import.meta.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key';
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
  takeRecords() { return []; }
} as any;

global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any;

global.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
  return setTimeout(() => cb(Date.now()), 16) as unknown as number;
});

global.cancelAnimationFrame = vi.fn((id: number) => {
  clearTimeout(id);
});

global.performance = {
  now: () => Date.now(),
} as Performance;

// EA-16: в проде вошедший пользователь без сейфа ничего не пишет в облако.
// Существующие тесты синхронизации моделируют такого пользователя намеренно
// (ось «сейф выключен» стенда постулатов), поэтому здесь запрет выключен;
// его проверяет src/core/crypto/__tests__/vaultRequiredForAccounts.test.ts.
(globalThis as { __jwVaultOptionalForTests?: boolean }).__jwVaultOptionalForTests = true;
