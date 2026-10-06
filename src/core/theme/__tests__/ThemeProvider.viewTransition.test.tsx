import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { ThemeProvider, useTheme } from '../ThemeProvider';

const THEME_CLASSES = ['theme-modern', 'theme-notion', 'theme-spotify', 'theme-amethyst'];

function ThemeSwitcher() {
  const { setThemeId } = useTheme();
  return <button type="button" onClick={() => setThemeId('notion')}>switch to notion</button>;
}

function renderSwitcher() {
  return render(
    <ThemeProvider>
      <ThemeSwitcher />
    </ThemeProvider>
  );
}

function clickSwitcher() {
  fireEvent.click(screen.getByRole('button', { name: 'switch to notion' }));
}

// Снимок classList берётся после возврата из колбэка: именно тогда браузер
// строит кадр «после». Класс, ещё не поменявшийся к этому моменту, = красный тест.
function stubViewTransition() {
  const after: string[][] = [];
  const impl = vi.fn((callback: () => void) => {
    callback();
    after.push(Array.from(document.documentElement.classList));
    return { finished: Promise.resolve() };
  });
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    writable: true,
    value: impl,
  });
  return { impl, after };
}

let restoreMatchMedia: (() => void) | null = null;

function mockReducedMotion(reducedMotion: boolean) {
  const mocked = vi.mocked(window.matchMedia);
  const originalImpl = mocked.getMockImplementation();
  mocked.mockImplementation(((query: string) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia);
  restoreMatchMedia = () => {
    if (originalImpl) mocked.mockImplementation(originalImpl);
  };
}

afterEach(() => {
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  restoreMatchMedia?.();
  restoreMatchMedia = null;
  localStorage.clear();
  document.documentElement.classList.remove(...THEME_CLASSES);
});

describe('MO-1 — смена темы: один кроссфейд вместо половины fade / половины snap', () => {
  it('переключение темы вызывает startViewTransition ровно один раз', () => {
    const { impl } = stubViewTransition();
    renderSwitcher();

    clickSwitcher();

    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('внутри колбэка DOM уже полностью в новой теме', () => {
    const { after } = stubViewTransition();
    expect(document.documentElement.classList.contains('theme-amethyst')).toBe(false);
    renderSwitcher();
    expect(document.documentElement.classList.contains('theme-amethyst')).toBe(true);

    clickSwitcher();

    expect(after).toHaveLength(1);
    expect(after[0]).toContain('theme-notion');
    expect(after[0]).not.toContain('theme-amethyst');
  });

  it('монтирование с сохранённой темой не анимируется', () => {
    localStorage.setItem(STORAGE_KEYS.APP_THEME, JSON.stringify('spotify'));
    const { impl } = stubViewTransition();

    renderSwitcher();

    expect(impl).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('theme-spotify')).toBe(true);
  });

  it('prefers-reduced-motion: без transition, но класс всё равно меняется', () => {
    mockReducedMotion(true);
    const { impl } = stubViewTransition();
    renderSwitcher();

    clickSwitcher();

    expect(impl).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('theme-notion')).toBe(true);
    expect(document.documentElement.classList.contains('theme-amethyst')).toBe(false);
  });

  it('startViewTransition отсутствует (Firefox < 144, старый Safari): класс меняется, не бросает', () => {
    expect(document.startViewTransition).toBeUndefined();
    renderSwitcher();

    expect(() => clickSwitcher()).not.toThrow();

    expect(document.documentElement.classList.contains('theme-notion')).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.APP_THEME)).toBe(JSON.stringify('notion'));
  });
});
