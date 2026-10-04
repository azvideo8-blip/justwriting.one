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

// Колбэк дёргается только пока среда жива: после teardown jsdom vitest снимает
// `window`, а 16-миллисекундный таймер motion-dom ещё может приехать — это давало
// unhandled `ReferenceError: window is not defined`, и полный `vitest run` выходил
// с кодом 1 при нуле красных файлов (1 прогон из 5).
global.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
  return setTimeout(() => {
    if (typeof window === 'undefined') return;
    cb(Date.now());
  }, 16) as unknown as number;
});

global.cancelAnimationFrame = vi.fn((id: number) => {
  clearTimeout(id);
});

if (typeof performance !== 'undefined') {
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
}

// EA-16: в проде вошедший пользователь без сейфа ничего не пишет в облако.
// Существующие тесты синхронизации моделируют такого пользователя намеренно
// (ось «сейф выключен» стенда постулатов), поэтому здесь запрет выключен;
// его проверяет src/core/crypto/__tests__/vaultRequiredForAccounts.test.ts.
(globalThis as { __jwVaultOptionalForTests?: boolean }).__jwVaultOptionalForTests = true;
