// MF-18 (SA-1): гейт «var(--x) без объявления». Степпер первого входа был
// прозрачным из-за `var(--surface-base)` — переменной нет в index.css.
// R7F-027 — что именно считается объявлением; R7Q-032 — почему гейт на Windows
// молчал зелёным.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findUndefinedVars, collectDeclarations, stripCssComments } from '../check-undefined-css-vars.mjs';
import { isMainRun, toPosixPath } from '../gate-paths.mjs';

const SCRIPT = join(process.cwd(), 'scripts/check-undefined-css-vars.mjs');

/** Корень-фикстура: index.css + один файл с использованием переменных. */
function fixture(css: string, usage: string): string {
  const root = mkdtempSync(join(tmpdir(), 'mf18-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/index.css'), css);
  writeFileSync(join(root, 'src/probe.tsx'), usage);
  return root;
}

describe('MF-18: undeclared CSS variables gate', () => {
  it('the repo has none (outside the commented allow-list)', () => {
    expect(findUndefinedVars(process.cwd())).toEqual([]);
  });

  it('exits non-zero on a probe file with var(--does-not-exist)', () => {
    const root = mkdtempSync(join(tmpdir(), 'mf18-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/index.css'), ':root { --declared: 1px; }');
    writeFileSync(join(root, 'src/probe.tsx'), 'const a = "bg-[var(--declared)] w-[var(--does-not-exist)] h-[var(--fallback,1px)]";');
    const run = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('src/probe.tsx:1 --does-not-exist');
    expect(run.stdout).not.toContain('--declared');
    expect(run.stdout).not.toContain('--fallback');
  });
});

// R7F-027: прежняя сборка объявлений была `/--[\w-]+\s*:/g` по всему файлу. Так
// «объявленной» становилась переменная, которая живёт только в комментарии, и
// переменная, объявленная в одной теме из четырёх: в трёх остальных `var(--x)`
// вычисляется в пустоту, а гейт этого не видел.
describe('R7F-027: объявлением считается то, что видит браузер', () => {
  it('строка `--x:` внутри комментария — не объявление', () => {
    // Комментарий именно ВНУТРИ блока: так и выглядит закомментированная
    // декларация, из-за которой прежний сбор `/--[\w-]+\s*:/g` по всему файлу
    // считал переменную объявленной.
    const css = ':root { /* --commented: 1px; */ --real: 2px; }';
    expect(css).toContain('--commented');
    expect(stripCssComments(css)).not.toContain('--commented');
    expect([...collectDeclarations(css).global]).toEqual(['--real']);
    const found = findUndefinedVars(fixture(css, 'const a = "border-[var(--commented)]";'));
    expect(found.some(l => l.includes('--commented')), found.join('\n')).toBe(true);
  });

  it('объявление только в одной `.theme-*` — находка; во всех темах — нет', () => {
    const oneTheme = '.theme-a { --only-a: 1px; --shared: 3px; }\n.theme-b { --shared: 2px; }';
    const decl = collectDeclarations(oneTheme);
    expect(decl.themeCount, 'обе темы посчитаны').toBe(2);
    expect(decl.everyTheme.has('--shared')).toBe(true);
    expect(decl.everyTheme.has('--only-a')).toBe(false);
    const found = findUndefinedVars(
      fixture(oneTheme, 'const a = "bg-[var(--only-a)] text-[var(--shared)]";'),
    );
    expect(found.length, found.join('\n')).toBe(1);
    expect(found[0]).toContain('--only-a');
    expect(found[0]).not.toContain('--shared');
  });

  it('две записи одной темы — одна тема; вложенный селектор темы тоже её', () => {
    // Иначе «есть во всех темах» зависело бы от того, сколько раз автор написал
    // селектор: `.theme-a` и `.theme-a .card` — это одна тема.
    const decl = collectDeclarations(
      '.theme-a { --x: 1px; }\n.theme-a .card { --y: 2px; }\n.theme-b { --x: 1px; --y: 3px; }',
    );
    expect(decl.themeCount).toBe(2);
    expect([...decl.everyTheme].sort()).toEqual(['--x', '--y']);
  });

  it('`:root` достаточно, даже когда тем нет вовсе', () => {
    const decl = collectDeclarations(':root { --x: 1px; }');
    expect(decl.themeCount).toBe(0);
    expect(decl.global.has('--x')).toBe(true);
    expect(findUndefinedVars(fixture(':root { --x: 1px; }', 'const a = "p-[var(--x)]";'))).toEqual([]);
  });

  it('вложенные блоки не путают подсчёт скобок', () => {
    const decl = collectDeclarations('@theme { --a: 1px; @media (min-width: 1px) { --b: 2px; } } .theme-c { --b: 3px; }');
    expect(decl.global.has('--a')).toBe(true);
    expect(decl.global.has('--b')).toBe(true);
  });

  it('на реальном репозитории ужесточённый гейт молчит', () => {
    expect(findUndefinedVars(process.cwd())).toEqual([]);
  });
});

// R7Q-032: `import.meta.url === \`file://${process.argv[1]}\`` и обратный слэш в
// путях. На Windows первое не совпадает никогда, и весь блок «найти и выйти с 1»
// не исполняется: гейт печатает ноль строк и выходит с нулём. Проверка на macOS
// — тот же класс поломки: путь, который `file://` + строка не описывает.
describe('R7Q-032: гейт запускается, когда путь не совпадает с `file://` + argv', () => {
  it('запуск из каталога с пробелом в имени находит и выходит с 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mf18 spaced-'));
    // Копия скриптов: import.meta.url обязан содержать %20, чего прежняя
    // конкатенация `file://${argv[1]}` не давала никогда.
    for (const f of ['check-undefined-css-vars.mjs', 'check-mobile-colors.mjs', 'gate-paths.mjs']) {
      cpSync(join(process.cwd(), 'scripts', f), join(dir, f));
    }
    const root = fixture(':root { --declared: 1px; }', 'const a = "w-[var(--missing)]";');
    const run = spawnSync(process.execPath, [join(dir, 'check-undefined-css-vars.mjs'), root], { encoding: 'utf8' });
    expect(run.status, `stdout=${run.stdout} stderr=${run.stderr}`).toBe(1);
    expect(run.stdout).toContain('--missing');
  });

  it('из чужого процесса гейт не запускается', () => {
    expect(isMainRun(undefined, 'file:///x.mjs')).toBe(false);
    expect(isMainRun('/repo/scripts/check-undefined-css-vars.mjs', 'file:///other.mjs')).toBe(false);
    expect(isMainRun(SCRIPT, import.meta.url)).toBe(false);
    expect(isMainRun(SCRIPT, `file://${SCRIPT}`)).toBe(true);
  });

  it('обратный слэш становится разделителем до сверки с регулярками', () => {
    expect(toPosixPath('src\\features\\x\\MobileFoo.tsx')).toBe('src/features/x/MobileFoo.tsx');
    expect(toPosixPath('src/features/x/MobileFoo.tsx')).toBe('src/features/x/MobileFoo.tsx');
  });
});
