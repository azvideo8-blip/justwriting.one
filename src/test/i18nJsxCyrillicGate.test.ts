// G-1: аудит i18n видел кириллицу только в аргументах confirmDialog/alertDialog/
// promptDialog и рапортовал «0», пока весь остальной интерфейс оставался невидимым.
// Здесь стережётся, что гейт видит JSX-текст и placeholder/aria-label/title/alt,
// не выдаёт ложных срабатываний на t() и комментарии, и что пустой прогон не
// считается зелёным.
//
// Фальсификация: убрать из findHardcodedJsxCyrillic ветку isJsxAttribute — тесты
// 2 и 3 краснеют; заменить glob на несуществующий каталог — краснеет тест 8.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
import path from 'node:path';
import { findHardcodedJsxCyrillic, isBlind } from '../../scripts/i18n-audit';
import { JSX_TEXT_ALLOWLIST, JSX_ATTR_ALLOWLIST } from '../../scripts/i18n-audit-allowlist';

const ROOT_DIR = path.resolve(__dirname, '../..');

const scan = (src: string) => findHardcodedJsxCyrillic(src, 'Test.tsx');

describe('AG-I18N-JSX-1 — findHardcodedJsxCyrillic', () => {
  it('1. ловит кириллицу в JSX-тексте вне t()', () => {
    const found = scan(`
      export function Save() {
        return <button>Сохранить заметку</button>;
      }
    `);
    expect(found.text).toHaveLength(1);
    expect(found.text[0]?.match).toContain('Сохранить заметку');
  });

  it('2. ловит кириллицу в placeholder, aria-label, title и alt', () => {
    const found = scan(`
      export function Fields() {
        return (
          <div>
            <input placeholder="Поиск по заметкам" />
            <button aria-label="Закрыть окно" />
            <img title="Обложка дневника" />
            <img alt="Портрет автора" />
          </div>
        );
      }
    `);
    expect(found.text).toHaveLength(0);
    expect(found.attrs.map(a => a.match)).toEqual([
      'placeholder="Поиск по заметкам"',
      'aria-label="Закрыть окно"',
      'title="Обложка дневника"',
      'alt="Портрет автора"',
    ]);
  });

  it('3. ловит шаблонную строку с подстановкой в атрибуте', () => {
    const found = scan(`
      export function Search({ q }) {
        return <input placeholder={\`Поиск \${q}\`} />;
      }
    `);
    expect(found.attrs).toHaveLength(1);
    expect(found.attrs[0]?.match).toContain('Поиск');
  });

  it('4. не трогает текст и атрибуты, пришедшие из t()', () => {
    const found = scan(`
      export function Save({ t }) {
        return (
          <div>
            <button>{t('activity_note_trashed')}</button>
            <input placeholder={t('admin_diag_title')} />
            <span className={t('admin_diag_download')}>OK</span>
          </div>
        );
      }
    `);
    expect(found.text).toHaveLength(0);
    expect(found.attrs).toHaveLength(0);
  });

  it('5. не трогает кириллицу в комментариях', () => {
    const found = scan(`
      // сохраняем черновик
      export function Save() {
        return (
          <div>
            {/* текст кнопки берётся из словаря */}
            <button>Save</button>
          </div>
        );
      }
    `);
    expect(found.text).toHaveLength(0);
    expect(found.attrs).toHaveLength(0);
  });

  it('6. строку внутри {…} считает, но в гейт не кладёт', () => {
    const found = scan(`
      export function Title({ title }: { title?: string }) {
        return <div>{title ?? 'Без названия'}</div>;
      }
    `);
    expect(found.text).toHaveLength(0);
    expect(found.attrs).toHaveLength(0);
    expect(found.expressionStrings).toBe(1);
  });

  it('7. кириллица за пределами JSX не считается JSX-долгом', () => {
    const found = scan(`
      const FALLBACK = 'Без названия';
      export function Title() {
        return <div>{FALLBACK}</div>;
      }
    `);
    expect(found.text).toHaveLength(0);
    expect(found.attrs).toHaveLength(0);
  });

  it('8. репозиторий: файлы разобраны и за пределом allowlist нарушений нет', () => {
    const tsFiles = globSync('src/**/*.{ts,tsx}', {
      ignore: ['src/shared/i18n/**', 'src/**/__tests__/**', 'node_modules/**'],
    });
    const tsxFiles = tsFiles.filter(f => f.endsWith('.tsx'));
    expect(tsxFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of tsxFiles) {
      const found = scan(readFileSync(file, 'utf-8'));
      if (found.text.length && !JSX_TEXT_ALLOWLIST.includes(file)) {
        offenders.push(...found.text.map(m => `${file}${m.match}`));
      }
      if (found.attrs.length && !JSX_ATTR_ALLOWLIST.includes(file)) {
        offenders.push(...found.attrs.map(m => `${file}: ${m.match}`));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('9. allowlist не разрастается молча: каждая запись под ним правда нарушает', () => {
    const stale: string[] = [];
    for (const file of JSX_TEXT_ALLOWLIST) {
      if (scan(readFileSync(file, 'utf-8')).text.length === 0) stale.push(`текст: ${file}`);
    }
    for (const file of JSX_ATTR_ALLOWLIST) {
      if (scan(readFileSync(file, 'utf-8')).attrs.length === 0) stale.push(`атрибуты: ${file}`);
    }
    expect(stale).toEqual([]);
  });

  // Под-процесс со своим бюджетом: в полном прогоне файл стартует на загрузке
  // процессора, и дефолтных 5 секунд ему не хватает (поймано на прогоне 28.09.26).
  it('10. сводка печатает число разобранных файлов и оно ненулевое', () => {
    const out = execFileSync('npx', ['tsx', 'scripts/i18n-audit.ts'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const parsed = /файлов разобрано: (\d+) из (\d+)/.exec(out);
    expect(parsed, out).not.toBeNull();
    expect(Number(parsed?.[1])).toBeGreaterThan(0);
    expect(Number(parsed?.[2])).toBeGreaterThan(0);
    expect(out).toMatch(/Hardcoded JSX: \d+/);
  }, 90_000);

  it('11. пустой прогон — слепой, а не чистый', () => {
    expect(isBlind(0, 0)).toBe(true);
    // ts/tsx есть, а .tsx-файлов ноль: JSX-часть гейта ничего не видела.
    expect(isBlind(488, 0)).toBe(true);
    expect(isBlind(0, 181)).toBe(true);
    expect(isBlind(488, 181)).toBe(false);
  });
});
