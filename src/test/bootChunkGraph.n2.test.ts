// BS (N-2): храповик стартового куска. Тест, который читает dist/, в этом
// репозитории бесполезен: `npm run test:ci` в ci.yml идёт до `npm run build`,
// то есть на воркере dist нет и тест молча пропускался бы. Поэтому проверяется
// причина, а не следствие: из точки входа `src/main.tsx` нельзя дойти
// СТАТИЧЕСКИМ импортом до движка синхронизации. Динамический `import(...)`
// границей не считается — именно он и держит код вне куска.
//
// Мутация: вернуть в любой стартовый файл `import { SyncService } from
// '../core/services/SyncService'` — и тест краснеет с именем файла и строки.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const SRC = join(process.cwd(), 'src');
const ENTRY = join(SRC, 'main.tsx');

// Что обязано приходить по требованию (BS: синхронизация — самая хрупкая часть,
// и она же — содержимое стартового куска до правки).
const MUST_BE_LAZY = [
  'core/services/LocalStoreSyncService.ts',
  'core/services/CloudSyncService.ts',
  'core/services/SyncService.ts',
  'core/services/LocalDocumentService.ts',
  'core/services/DocumentService.ts',
  'core/services/StorageService.ts',
  'core/services/ConflictResolver.ts',
  'core/services/EncryptionService.ts',
  'core/services/dialogueSegments.ts',
  'core/storage/dialogueMerge.ts',
  'core/sync/changeCursor.ts',
  'features/ai/services/AIEmbeddingService.ts',
  'features/auth/components/MigrationPrompt.tsx',
  'features/settings/components/SettingsPanel.tsx',
];

// BR-3 (ревью 25.10): пакет добавил на главный полосу синка, баннер «в облаке
// есть заметки» и хук пустого устройства — все три вошли в стартовый кусок, и
// `index-*.js` перешагнул порог 100 000 gzip (CI 40167198606). Строки показаны
// по требованию: в рейке и под баннером — ленивый импорт, как `SyncService`
// внутри самой полосы.
const HOME_STRIP_MUST_BE_LAZY = [
  'core/components/SyncUnsyncedBar.tsx',
  'features/writing/components/CloudNotesBanner.tsx',
  'core/sync/useEmptyDeviceDetection.ts',
];

function asPosix(p: string) { return p.split(sep).join('/'); }
/** Ключи графа — всегда относительные «src/…»: с абсолютными путями проверка
 *  «модуля нет в множестве» зелёная всегда, и тест ничего не сверяет. */
const SRC_PREFIX = asPosix(SRC) + '/';
function relKey(p: string) { return asPosix(p).replace(SRC_PREFIX, 'src/'); }

function resolveSpec(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Снимает комментарии, чтобы закоммеченный import не притворялся ребром. */
function stripComments(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Статические рёбра: `import x from '…'`, `import '…"`, `export * from '…'`.
 *  Динамический import(…) и import.meta не попадают. */
function staticDeps(file: string): string[] {
  const src = stripComments(readFileSync(file, 'utf8'));
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"]*?\bfrom\s*)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) { if (m[1]) out.push(m[1]); }
  return out;
}

function chain(target: string, parent: Map<string, string>): string {
  const out = [target];
  let cur = target;
  while (parent.has(cur)) { cur = parent.get(cur)!; out.unshift(cur); }
  return out.join(' → ');
}

function reachableFromEntry(): Map<string, string> {
  const parent = new Map<string, string>();
  const start = relKey(ENTRY);
  const seen = new Set<string>([start]);
  let queue = [ENTRY];
  while (queue.length) {
    const next: string[] = [];
    for (const file of queue) {
      for (const spec of staticDeps(file)) {
        const dep = resolveSpec(file, spec);
        if (!dep) continue;
        const key = relKey(dep);
        if (seen.has(key)) continue;
        seen.add(key);
        parent.set(key, relKey(file));
        next.push(dep);
      }
    }
    queue = next;
  }
  return parent;
}

describe('BS (N-2): движок синхронизации не в стартовом куске', () => {
  const parent = reachableFromEntry();
  const boot = new Set([relKey(ENTRY), ...parent.keys()]);

  it('точка входа существует и граф не пустой (тест не холостой)', () => {
    expect(boot.has('src/main.tsx')).toBe(true);
    expect(boot.size).toBeGreaterThan(50);
    // Страховка от «множество всегда пустое»: эти модули в старте обязаны быть.
    expect(boot.has('src/app/AppShell.tsx')).toBe(true);
    expect(boot.has('src/core/sync/useSyncStatus.ts')).toBe(true);
    expect(boot.has('src/core/storage/localDb.ts')).toBe(true);
  });

  for (const mod of MUST_BE_LAZY) {
    it(`src/${mod} недостижим статически из main.tsx`, () => {
      expect(boot.has(`src/${mod}`), `статическая цепочка: ${chain(`src/${mod}`, parent)}`).toBe(false);
    });
  }

  // BR-3: полоська/баннер/хук пустого устройства — вне старта; сам тест
  // краснеет, если кто-то вернёт в AppShell или рейку статический импорт.
  for (const mod of HOME_STRIP_MUST_BE_LAZY) {
    it(`src/${mod} (BR-3) недостижим статически из main.tsx`, () => {
      expect(boot.has(`src/${mod}`), `статическая цепочка: ${chain(`src/${mod}`, parent)}`).toBe(false);
    });
  }

  it('размер стартового графа не растёт бесконтрольно (список проверяется в тесте выше)', () => {
    // Отдельная страховка: если кто-то вернёт тяжёлую ветку через barrel
    // (src/core/data/index.ts), это видно и по числу модулей в старте.
    expect(boot.size).toBeLessThan(220);
  });
});
