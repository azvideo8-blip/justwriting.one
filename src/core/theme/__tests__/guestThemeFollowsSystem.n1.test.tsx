// N-1 (SA-20): тема гостя на телефоне следует prefers-color-scheme.
// До правки у человека без аккаунта и без выбранной темы стоял тёмный «Аметистовый»
// независимо от системной светлой схемы (login-l360.png был тёмным).
// Явно выбранная тема и десктоп не меняются.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { ThemeProvider } from '../ThemeProvider';

const THEME_CLASSES = ['theme-modern', 'theme-notion', 'theme-spotify', 'theme-amethyst'];

function mockMedia({ dark, narrow }: { dark: boolean; narrow: boolean }) {
  vi.mocked(window.matchMedia).mockImplementation(((query: string) => ({
    matches: query.includes('prefers-color-scheme') ? dark : (query.includes('max-width') ? narrow : false),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia);
}

function root() { return document.documentElement; }

afterEach(() => {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList);
  localStorage.clear();
  root().classList.remove(...THEME_CLASSES);
});

describe('N-1 · тема гостя', () => {
  it('гость на телефоне со светлой системной схемой видит светлую тему', () => {
    mockMedia({ dark: false, narrow: true });
    render(<ThemeProvider guestFollowsSystem><div /></ThemeProvider>);
    expect(root().classList.contains('theme-notion')).toBe(true);
  });

  it('гость на телефоне с тёмной системной схемой видит тёмную тему', () => {
    mockMedia({ dark: true, narrow: true });
    render(<ThemeProvider guestFollowsSystem><div /></ThemeProvider>);
    expect(root().classList.contains('theme-amethyst')).toBe(true);
  });

  it('без флага гостя поведение как раньше: тёмная тема по умолчанию', () => {
    mockMedia({ dark: false, narrow: true });
    render(<ThemeProvider><div /></ThemeProvider>);
    expect(root().classList.contains('theme-amethyst')).toBe(true);
  });

  it('явно выбранная тема сильнее системной схемы', () => {
    mockMedia({ dark: false, narrow: true });
    localStorage.setItem(STORAGE_KEYS.APP_THEME, JSON.stringify('spotify'));
    render(<ThemeProvider guestFollowsSystem><div /></ThemeProvider>);
    expect(root().classList.contains('theme-spotify')).toBe(true);
    expect(root().classList.contains('theme-notion')).toBe(false);
  });
});
