// Prod-dependency security gate for CI.
//
// Wraps `npm audit --omit=dev --audit-level=high` but allows a SHORT, documented
// list of advisories that do not apply to this app and have no forward fix. Any
// high/critical advisory NOT on the allowlist fails the build, so the gate still
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
};

let raw;
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--audit-level=high', '--json'], { encoding: 'utf8' });
} catch (e) {
  // npm audit exits non-zero when advisories exist; the JSON report is still on stdout.
  raw = e.stdout?.toString() ?? '';
}

const report = JSON.parse(raw || '{}');
const blocking = new Set();
const allowed = new Set();

for (const pkg of Object.values(report.vulnerabilities ?? {})) {
  if (pkg.severity !== 'high' && pkg.severity !== 'critical') continue;
  for (const via of pkg.via ?? []) {
    if (typeof via !== 'object' || !via.url) continue; // string vias are transitive edges
    const ghsa = via.url.split('/advisories/')[1] ?? via.url;
    const line = `${ghsa}  [${pkg.severity}] ${via.name ?? pkg.name}: ${via.title ?? ''}`;
    (ALLOW[ghsa] ? allowed : blocking).add(line);
  }
}

for (const a of allowed) console.log(`ALLOWED  ${a}`);

if (blocking.size > 0) {
  console.error(`\n✖ ${blocking.size} blocking high/critical advisory(ies):`);
  for (const b of blocking) console.error(`  ${b}`);
  console.error('\nFix them, or — only if genuinely N/A with no forward fix — add a documented entry to scripts/prod-audit.mjs.');
  process.exit(1);
}

console.log('\n✔ No blocking advisories (allowlisted exceptions are documented in scripts/prod-audit.mjs).');
