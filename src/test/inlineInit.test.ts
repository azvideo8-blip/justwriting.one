// R3-046: скрипт до первой отрисовки ставит класс и фон темы. Тема лежит в
// localStorage JSON-строкой; прежде её искали сырым значением и не находили.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEMES } from '../core/theme/ThemeProvider';

const script = readFileSync(resolve(__dirname, '../../public/inline-init.js'), 'utf8');
const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
const run = () => new Function(script)();

function setSystemDark(dark: boolean) {
  window.matchMedia = ((q: string) => ({ matches: dark && q.includes('dark') })) as unknown as typeof window.matchMedia;
}

describe('inline-init.js', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
  });

  it('читает тему, сохранённую useLocalStorage (JSON)', () => {
    localStorage.setItem('app-theme', JSON.stringify('notion'));
    run();
    expect(document.documentElement.classList.contains('theme-notion')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it("'system' при светлой системе — светлая тема", () => {
    setSystemDark(false);
    localStorage.setItem('app-theme', JSON.stringify('system'));
    run();
    expect(document.documentElement.classList.contains('theme-notion')).toBe(true);
  });

  it('фон каждой темы совпадает с её --bg-base в index.css', () => {
    for (const th of Object.values(THEMES)) {
      document.documentElement.className = '';
      localStorage.setItem('app-theme', JSON.stringify(th.id));
      run();
      const block = css.slice(css.indexOf(`.${th.cssClass} {`));
      const bgBase = /--bg-base:\s*(#[0-9A-Fa-f]{6})/.exec(block)![1]!;
      const div = document.createElement('div');
      div.style.background = bgBase;
      expect(document.documentElement.style.background).toBe(div.style.background);
    }
  });
});
