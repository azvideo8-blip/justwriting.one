#!/usr/bin/env node
// Здоровье выпусков (статья команды Claude Code о ревью, 2026-10-24): экономия на
// проверках видна по откатам и хотфиксам, а не по скорости. Считает по `main`:
// правки кода между выпусками (выпуск — squash, всё остальное в коде — хотфикс),
// откаты и выпуски, вышедшие через < 24 ч после прошлого. До 0.10.0 работа шла
// коммитами прямо в main — у тех выпусков «хотфиксы» завышены; честно с 0.10.x.
import { execFileSync } from 'node:child_process';

const RELEASE_RE = /^(?:release|chore\(release\)): (\d+\.\d+\.\d+)/;
const CODE_RE = /^(?:src|api|deploy\/api|public)\//;

/** entries: [{ sha, at (сек), subject, files }] по порядку, старые первыми. */
export function releaseHealth(entries) {
  /** @type {{ version: string, at: number, hotfixes: number, hoursToNext: number | null }[]} */
  const releases = [];
  let reverts = 0;
  for (const e of entries) {
    if (/\brevert/i.test(e.subject)) reverts++;
    const m = RELEASE_RE.exec(e.subject);
    if (m) { releases.push({ version: m[1] ?? '', at: e.at, hotfixes: 0, hoursToNext: null }); continue; }
    const last = releases.at(-1);
    if (last && e.files.some(f => CODE_RE.test(f))) last.hotfixes++;
  }
  releases.forEach((r, i) => { r.hoursToNext = i + 1 < releases.length ? Math.round((releases[i + 1].at - r.at) / 3600) : null; });
  return {
    releases,
    reverts,
    hotfixed: releases.filter(r => r.hotfixes > 0).length,
    quickFollowUps: releases.filter(r => r.hoursToNext !== null && r.hoursToNext < 24).length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = Number(process.argv[2] ?? 20);
  const log = execFileSync('git', ['log', '--first-parent', 'origin/main', '--reverse', '--name-only', '--format=%x00%H%x09%ct%x09%s'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const entries = log.split('\0').filter(Boolean).map(chunk => {
    const [head, ...files] = chunk.trim().split('\n');
    const [sha, at, subject] = head.split('\t');
    return { sha, at: Number(at), subject, files: files.filter(Boolean) };
  });
  const h = releaseHealth(entries);
  const last = h.releases.slice(-n);
  console.log('выпуск   ч до след.  хотфиксов');
  for (const r of last) console.log(`${r.version.padEnd(8)} ${String(r.hoursToNext ?? '—').padStart(9)}  ${r.hotfixes}`);
  console.log(`\nпоследние ${last.length}: с хотфиксами ${last.filter(r => r.hotfixes).length}, следующий < 24 ч: ${last.filter(r => r.hoursToNext !== null && r.hoursToNext < 24).length}; откатов за всю историю: ${h.reverts}`);
}
