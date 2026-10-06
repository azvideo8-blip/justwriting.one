// Prod-dependency security gate for CI.
//
// Wraps `npm audit --omit=dev --audit-level=moderate` but allows a SHORT, documented
// list of advisories that do not apply to this app and have no forward fix. Any
// moderate-or-worse advisory NOT on the allowlist fails the build, so the gate still
// protects against every future advisory — only the named exceptions pass.
//
// Review every entry whenever its package is upgraded.
import { execFileSync } from 'node:child_process';

const ALLOW = {
  // react-router "RSC Mode CSRF Bypass". Affects React Router in RSC / server-action
  // mode only. This app is a client-only SPA using <BrowserRouter> (src/main.tsx) —
  // no SSR, no RSC, no server actions — so it is not reachable. No forward fix
  // exists: 7.18.1 is the latest published version and `npm audit fix --force`
  // downgrades to 7.11.0, reintroducing the open-redirect + DoS advisories that
  // 7.18.1 fixes. Re-check on the next react-router bump.
  'GHSA-qwww-vcr4-c8h2': 'react-router RSC-mode CSRF — N/A to a client-only BrowserRouter SPA',

  // nanoid "non-secure generators can loop indefinitely with negative size".
  // Pulled transitively by docx@9.6.1 for internal XML element ID generation.
  // docx only calls nanoid() with default positive size, never passing negative size
  // to custom non-secure generators.
  'GHSA-28wg-ghj8-5hjv': 'nanoid negative size loop via docx — N/A (docx only uses standard positive-size ID generation)',

  // sprintf-js "DoS through unbounded precision specifiers" (2026-10-06, range `*` —
  // no fixed version). Pulled by mammoth@1.13.0 → argparse@1 → sprintf-js, and
  // argparse is required only by mammoth's CLI (node_modules/mammoth/bin/mammoth);
  // the app imports mammoth's library entry (archiveImport.ts), and the built
  // bundle contains neither argparse nor sprintf. The API does not depend on
  // mammoth. Re-check on the next mammoth bump.
  'GHSA-hp3w-g68c-fv3c': 'sprintf-js via mammoth CLI (argparse) — N/A, not in the bundle',
};

// B-3 (R2-018): набор зависимостей службы — отдельный. `deploy/api/package.json` +
// лок раскатываются на VPS, и корень их не покрывает (workspaces в корневом
// манифесте нет): гейт, который смотрит только в корень, аудится то, что на сервер
// не едет. Те же порог и тот же allowlist для обоих наборов; в строке findings
// указано, откуда набор.
const SETS = [
  { cwd: '.', label: 'root (client bundle)' },
  { cwd: 'deploy/api', label: 'deploy/api (API service)' },
];

function fail(message) {
  console.error(`prod-audit: ${message}`);
  process.exit(1);
}

function auditSet(set) {
  let raw;
  try {
    raw = execFileSync(
      'npm',
      ['audit', '--omit=dev', '--audit-level=moderate', '--json'],
      { cwd: set.cwd, encoding: 'utf8' },
    );
  } catch (e) {
    // npm audit exits non-zero when advisories exist; the JSON report is still on stdout.
    raw = e.stdout?.toString() ?? '';
  }

  // Пустой stdout значит, что команда не отработала, а не что уязвимостей нет.
  // execFileSync кидает и при найденных уязвимостях (отчёт на stdout), и при
  // настоящем сбое — нет сети, недоступен реестр. Различать обязательно: это
  // первый гейт в CI, и «проверить не смогли» не равно «проверили, чисто».
  if (!raw.trim()) fail(`${set.label}: npm audit не дал вывода — проверка не выполнена, а не пройдена.`);

  let report;
  try {
    report = JSON.parse(raw);
  } catch (e) {
    fail(`${set.label}: не удалось разобрать вывод npm audit: ${e instanceof Error ? e.message : e}`);
  }

  // Тот же разбор «не равно» для отчёта, который пришёл, но не является отчётом:
  // сбой реестра npm печатает JSON с `message`/`error` и без `vulnerabilities`,
  // и без этой строки такой вывод читался бы как «наборов проверено, чисто».
  if (!report || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    fail(`${set.label}: вывод npm audit не содержит раздела уязвимостей — проверка не выполнена.`);
  }

  return report;
}

const blocking = new Set();
const allowed = new Set();

for (const set of SETS) {
  const report = auditSet(set);
  for (const pkg of Object.values(report.vulnerabilities ?? {})) {
    // Порог был 'high', и уязвимость DOMPurify (moderate) до гейта не доходила
    // вовсе — при том что DOMPurify чистит весь вывод модели. Для несущей
    // защиты 'moderate' — не тот уровень, который можно не заметить.
    if (pkg.severity === 'low' || pkg.severity === 'info') continue;
    for (const via of pkg.via ?? []) {
      if (typeof via !== 'object' || !via.url) continue; // string vias are transitive edges
      const ghsa = via.url.split('/advisories/')[1] ?? via.url;
      const line = `${ghsa}  [${pkg.severity}] ${via.name ?? pkg.name}: ${via.title ?? ''}`;
      (ALLOW[ghsa] ? allowed : blocking).add(`[${set.label}] ${line}`);
    }
  }
}

for (const a of allowed) console.log(`ALLOWED  ${a}`);

if (blocking.size > 0) {
  console.error(`\n✖ ${blocking.size} blocking advisory(ies) (moderate and above):`);
  for (const b of blocking) console.error(`  ${b}`);
  console.error('\nFix them, or — only if genuinely N/A with no forward fix — add a documented entry to scripts/prod-audit.mjs.');
  process.exit(1);
}

console.log(`\n✔ No blocking advisories in ${SETS.map(s => s.cwd).join(', ')} (allowlisted exceptions are documented in scripts/prod-audit.mjs).`);
