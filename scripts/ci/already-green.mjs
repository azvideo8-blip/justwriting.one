// Решение владельца 2026-10-20: CI на main не гоняет тесты второй раз, если
// РОВНО ТО ЖЕ дерево кода уже прошло полный CI на рабочей ветке (выпуск сначала
// зеленеет на ветке, потом тот же код ставится в main одним коммитом — дерево
// бит в бит то же, и прогон на main повторял час работы впустую).
//
// Строго: двойник засчитывается, только если это push-прогон ci.yml НЕ на main,
// он завершён успехом, дерево его коммита совпадает с деревом этого коммита
// (а дерево включает и сам ci.yml — то есть и те же джобы), и каждый тяжёлый
// джоб в нём — success, а не skipped (двойник двойника не засчитывается).
// Любая неясность или сбой чтения — двойника нет, тесты идут полностью.
import { appendFileSync } from 'node:fs';
import { isMainRun } from '../gate-paths.mjs';

export const REQUIRED_JOBS = ['build', 'rls', 'mobile-e2e'];
// Шаги, которые обязаны реально выполниться: мобильный e2e внутри джоба
// пропускается, если в push не менялось приложение (diff от event.before) —
// джоб при этом «success», а e2e не гонялся (проверка коммита 5fbab718).
export const REQUIRED_STEPS = { 'mobile-e2e': 'Mobile e2e on the stand' };

/**
 * @param {{ sha: string, runs: Array<{id:number, head_sha:string, head_branch:string, event:string, conclusion:string|null, status:string, path?:string}>,
 *           treeOf: (sha: string) => Promise<string>, jobsOf: (runId: number) => Promise<Array<{name:string, conclusion:string|null, steps?: Array<{name:string, conclusion:string|null}>}>> }} p
 * @returns {Promise<number|null>} id прогона-двойника или null
 */
export async function findGreenTwin({ sha, runs, treeOf, jobsOf }) {
  const tree = await treeOf(sha);
  for (const run of runs) {
    if (run.event !== 'push' || run.head_branch === 'main') continue;
    if (run.status !== 'completed' || run.conclusion !== 'success') continue;
    if (run.path && !run.path.endsWith('.github/workflows/ci.yml')) continue;
    if (run.head_sha !== sha && (await treeOf(run.head_sha)) !== tree) continue;
    const jobs = await jobsOf(run.id);
    const ok = REQUIRED_JOBS.every(name => jobs.some(j => j.name === name && j.conclusion === 'success'))
      && Object.entries(REQUIRED_STEPS).every(([job, step]) =>
        jobs.some(j => j.name === job && (j.steps ?? []).some(st => st.name === step && st.conclusion === 'success')));
    if (ok) return run.id;
  }
  return null;
}

async function main() {
  const { GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_OUTPUT } = process.env;
  const api = async (path) => {
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/${path}`, {
      headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  };
  const { workflow_runs: runs } = await api('actions/workflows/ci.yml/runs?event=push&status=success&per_page=30');
  const twin = await findGreenTwin({
    sha: GITHUB_SHA,
    runs,
    treeOf: async (sha) => (await api(`git/commits/${sha}`)).tree.sha,
    jobsOf: async (id) => (await api(`actions/runs/${id}/jobs?per_page=50`)).jobs,
  });
  if (twin) {
    console.log(`Дерево ${GITHUB_SHA} уже прошло полный CI: прогон ${twin}. Тяжёлые джобы пропускаются.`);
    appendFileSync(GITHUB_OUTPUT, `run=${twin}\n`);
  } else {
    console.log('Двойника с зелёным CI нет — полный прогон.');
  }
}

if (isMainRun(process.argv[1], import.meta.url)) {
  // Сбой чтения — двойника нет: тесты идут полностью, а не пропускаются.
  main().catch((err) => console.log(`::warning::двойник не проверен (${err.message}) — полный прогон`));
}
