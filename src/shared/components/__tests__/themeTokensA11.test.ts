// A-11: цвета тем живут в index.css под --theme-*, а не hex/rgba в компонентах.
// Мутация: вернуть hex в ThemeBackground/EditorTab/JustWritingLogo → тест красный.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FILES = [
  'src/core/theme/ThemeBackground.tsx',
  'src/features/settings/components/EditorTab.tsx',
  'src/shared/components/JustWritingLogo.tsx',
];

describe('A-11: цвета тем — только через токены', () => {
  it('нет hex и rgba в перенесённых местах', () => {
    for (const file of FILES) {
      const body = readFileSync(file, 'utf8');
      expect(body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [], file).toEqual([]);
    }
  });

  it('переменные объявлены в index.css', () => {
    const css = readFileSync('src/index.css', 'utf8');
    for (const name of ['--theme-bg-spotify', '--theme-bg-notion', '--theme-accent-modern', '--logo-on-dark']) {
      expect(css).toContain(name);
    }
  });
});
