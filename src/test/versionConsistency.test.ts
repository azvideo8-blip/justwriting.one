// F-041 / G-3: версия живёт в четырёх местах — src/version.ts, package.json,
// package-lock.json и CACHE_VERSION в public/sw.js. Их сводят руками, и разъезд молча стоит людям
// старого кэша: service worker сравнивает имя кэша с версией приложения, а
// о расхождении не сообщает никто. Тест держит их вместе.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../version';
import packageJson from '../../package.json';

const ROOT_DIR = path.resolve(__dirname, '../..');

describe('AG-VERSION-1 — версия в четырёх местах одна', () => {
  it('public/sw.js объявляет CACHE_VERSION в ожидаемом формате', () => {
    const sw = readFileSync(path.join(ROOT_DIR, 'public/sw.js'), 'utf-8');
    const declared = /const CACHE_VERSION = '([^']+)';/.exec(sw);
    // Если формат строки изменят, тест обязан покраснеть здесь, а не «пройти»
    // с пустым сравнением.
    expect(declared, 'в public/sw.js не найден `const CACHE_VERSION = \'…\'`').not.toBeNull();
    expect(declared?.[1]).toBe(`v${APP_VERSION}`);
  });

  it('APP_VERSION совпадает с version в package.json', () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });

  // R4-086: голова CHANGELOG.md и changelog[0].version не были пришиты к
  // APP_VERSION — релиз можно было собрать с разъехавшейся историей.
  it('голова CHANGELOG.md — текущая версия', () => {
    const changelog = readFileSync(path.join(ROOT_DIR, 'CHANGELOG.md'), 'utf-8');
    const head = /^##\s*\[?([0-9]+\.[0-9]+\.[0-9]+)\]?/m.exec(changelog);
    expect(head, 'в CHANGELOG.md нет заголовка версии').not.toBeNull();
    expect(head?.[1]).toBe(APP_VERSION);
  });

  it('changelog[0].version — текущая версия', () => {
    const changelog = readFileSync(path.join(ROOT_DIR, 'src/features/navigation/data/changelog.ts'), 'utf-8');
    const head = /version:\s*'([0-9]+\.[0-9]+\.[0-9]+)'/.exec(changelog);
    expect(head, 'в changelog.ts не найдена первая версия').not.toBeNull();
    expect(head?.[1]).toBe(APP_VERSION);
  });

  it('package-lock.json описывает ту же версию (обе записи)', () => {
    const lock = JSON.parse(readFileSync(path.join(ROOT_DIR, 'package-lock.json'), 'utf-8')) as {
      version: string; packages: Record<string, { version?: string }>;
    };
    expect(lock.version).toBe(APP_VERSION);
    expect(lock.packages['']?.version).toBe(APP_VERSION);
  });
});
