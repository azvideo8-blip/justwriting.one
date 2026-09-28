// F-041 / G-3: версия живёт в трёх местах — src/version.ts, package.json и
// CACHE_VERSION в public/sw.js. Их сводят руками, и разъезд молча стоит людям
// старого кэша: service worker сравнивает имя кэша с версией приложения, а
// о расхождении не сообщает никто. Тест держит их вместе.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../version';
import packageJson from '../../package.json';

const ROOT_DIR = path.resolve(__dirname, '../..');

describe('AG-VERSION-1 — версия в трёх местах одна', () => {
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
});
