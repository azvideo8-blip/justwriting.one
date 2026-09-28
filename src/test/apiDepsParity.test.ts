// D-3 / F-043: зависимости службы на сервере обязаны быть тем же набором, на
// котором крутятся тесты. Пока манифест жил одним файлом с диапазонами и без
// лока, он разошёлся с корнем (ai ^6.0.257 против ^6.0.191), и прод получал
// версии, которые CI не видел. Транзитивные зависимости при этом совпадать не
// обязаны — графы разные; фиксируется ровно то, что импортит бандл.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import rootPackageJson from '../../package.json';

const ROOT_DIR = path.resolve(__dirname, '../..');
const API_DIR = path.join(ROOT_DIR, 'deploy/api');

type Lock = {
  lockfileVersion: number;
  packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
};

const manifest = JSON.parse(
  readFileSync(path.join(API_DIR, 'package.json'), 'utf-8'),
) as { dependencies: Record<string, string> };
const apiLock = JSON.parse(
  readFileSync(path.join(API_DIR, 'package-lock.json'), 'utf-8'),
) as Lock;
const rootLock = JSON.parse(
  readFileSync(path.join(ROOT_DIR, 'package-lock.json'), 'utf-8'),
) as Lock;

const names = Object.keys(manifest.dependencies);

describe('AG-DEPS-1 — зависимости службы совпадают с корневым локом', () => {
  it('манифест службы объявлен и непустой', () => {
    expect(names.length, 'deploy/api/package.json без зависимостей — тест пустой').toBeGreaterThan(0);
  });

  it('старый файл без лока не вернулся', () => {
    expect(existsSync(path.join(ROOT_DIR, 'deploy/api-package.json'))).toBe(false);
  });

  it('версии точные, без диапазонов', () => {
    // Каретка в этом файле и была причиной: она разрешалась в другую версию на
    // каждой выкатке. Лок рядом с ней ничего не гарантировал, потому что
    // выкатка делала npm install.
    for (const [name, range] of Object.entries(manifest.dependencies)) {
      expect(range, `${name} объявлен диапазоном ${range}`).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
    }
  });

  it('каждая зависимость службы = та же версия в корневом локе', () => {
    const problems: string[] = [];
    for (const name of names) {
      const pinned = manifest.dependencies[name];
      const rootDeclared = (rootPackageJson as { dependencies?: Record<string, string> }).dependencies ?? {};
      if (!(name in rootDeclared)) {
        problems.push(`${name}: нет в dependencies корневого package.json`);
        continue;
      }
      const rootVersion = rootLock.packages[`node_modules/${name}`]?.version;
      const apiVersion = apiLock.packages[`node_modules/${name}`]?.version;
      if (!rootVersion) problems.push(`${name}: нет в корневом локе`);
      if (!apiVersion) problems.push(`${name}: нет в локе службы`);
      if (rootVersion && apiVersion && rootVersion !== apiVersion) {
        problems.push(`${name}: лок службы ${apiVersion} != корень ${rootVersion}`);
      }
      if (rootVersion && rootVersion !== pinned) {
        problems.push(`${name}: манифест службы ${pinned} != корень ${rootVersion}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('лок службы описывает тот же манифест, что лежит рядом', () => {
    expect(apiLock.lockfileVersion).toBe(3);
    expect(apiLock.packages['']?.dependencies).toEqual(manifest.dependencies);
  });
});
