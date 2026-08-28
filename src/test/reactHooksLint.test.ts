import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import packageJson from '../../package.json';

describe('AG-HOOKS-1 — eslint-plugin-react-hooks@7.1.1 enforcement', () => {
  it('has eslint-plugin-react-hooks at version >= 7.1.1', () => {
    const version = packageJson.devDependencies['eslint-plugin-react-hooks'];
    expect(version).toBeDefined();
    expect(version).toMatch(/^[~^]?7\.1\.[1-9]/);
  });

  it('ensures every react-hooks/set-state-in-effect suppression has an explicit documented reason', () => {
    let unreasonedSuppressions: string[] = [];
    try {
      const output = execSync(
        'grep -rn "eslint-disable.*react-hooks/set-state-in-effect" src/features src/app src/core src/shared | grep -v "\\-\\-" || true',
        { encoding: 'utf8' }
      ).trim();
      if (output) {
        unreasonedSuppressions = output.split('\n');
      }
    } catch {
      // no matches means clean
    }
    expect(unreasonedSuppressions).toEqual([]);
  });

  // Тикет просил третью корзину — «слишком дорого судить сейчас» — с
  // храповиком, чтобы долг оставался видимым. Её не сделали: всё, что не
  // починили, ушло в подавления. Проверка формы («есть причина») этого не
  // ловит: двадцать новых отписок со словами «async fetch» пройдут молча.
  // Поэтому стережём ЧИСЛО. Опускать порог можно, поднимать — нет.
  it('the number of set-state-in-effect suppressions does not grow', () => {
    const CEILING = 31; // замер 2026-08-28 (AG-HOOKS-2: 36 -> 31); править только вниз
    const out = execSync(
      'grep -rn "eslint-disable.*react-hooks/set-state-in-effect" src/features src/app src/core src/shared | wc -l',
      { encoding: 'utf8' },
    ).trim();
    const count = Number(out);
    expect(Number.isFinite(count)).toBe(true);
    expect(count).toBeLessThanOrEqual(CEILING);
  });
});
