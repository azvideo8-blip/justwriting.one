// R5-013 / R5-021 / R5-053: расписание gates.yml GitHub доставляет с опозданием
// (30.09: слот 03:17Z пришёл в 09:43Z) или не доставляет вовсе, а пропуск
// выглядит так же, как «всё хорошо». Перед выкаткой смотрим, когда джобы
// gates.yml последний раз ПРОШЛИ, и громко предупреждаем, если давно.
//
// ponytail: только ::warning::, выкатку не валит — ручной `gh workflow run
// gates.yml` снимает предупреждение. Нужна жёсткость — exit 1 вместо warning.

/** Имя джоба в gates.yml → сколько суток без успешного прогона терпим.
 *  Сутки + запас на опоздание расписания; неделя + сутки. */
export const MAX_AGE_DAYS = {
  'Full-history secret scan (B-4 / R2-017)': 2,
  'Testability & Mutations Gates': 8,
};

/** jobs: [{ name, conclusion, completed_at }] из /actions/runs/{id}/jobs. */
export function staleGateWarnings(jobs, now = Date.now()) {
  const out = [];
  for (const [name, days] of Object.entries(MAX_AGE_DAYS)) {
    const last = jobs
      .filter((j) => j.name === name && j.conclusion === 'success' && j.completed_at)
      .map((j) => Date.parse(j.completed_at))
      .sort((a, b) => b - a)[0];
    if (last === undefined) {
      out.push(`gates.yml «${name}»: успешного прогона не найдено — ворота не измерены`);
    } else {
      const age = (now - last) / 86_400_000;
      if (age > days) {
        out.push(`gates.yml «${name}»: последний успешный прогон ${age.toFixed(1)} сут назад (порог ${days}) — расписание пропущено или красное`);
      }
    }
  }
  return out;
}

async function main() {
  const { GH_TOKEN, GITHUB_REPOSITORY } = process.env;
  const api = async (path) => {
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/${path}`, {
      headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  };
  const { workflow_runs: runs } = await api('actions/workflows/gates.yml/runs?per_page=30');
  const jobs = [];
  for (const run of runs) {
    jobs.push(...(await api(`actions/runs/${run.id}/jobs`)).jobs);
    if (staleGateWarnings(jobs).length === 0) break;
  }
  const warnings = staleGateWarnings(jobs);
  for (const w of warnings) console.log(`::warning::${w}`);
  if (warnings.length === 0) console.log('gates.yml: все ворота прошли в срок');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Неудачное чтение — «не измерено», а не «всё хорошо» и не упавшая выкатка.
  main().catch((err) => console.log(`::warning::свежесть gates.yml не измерена: ${err.message}`));
}
