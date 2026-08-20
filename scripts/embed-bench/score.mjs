import { readFileSync, readdirSync } from 'node:fs';
const files = process.argv.slice(2).length ? process.argv.slice(2)
  : readdirSync('.').filter(f => f.startsWith('out-') && f.endsWith('.json'));
const rows = [];
for (const f of files) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  let recallSum = 0, mrrSum = 0, perfect = 0;
  const detail = [];
  for (const r of d.results) {
    const hits = r.top.filter(id => r.rel.includes(id));
    const recall = hits.length / r.rel.length;
    const firstRank = r.top.findIndex(id => r.rel.includes(id));
    const mrr = firstRank === -1 ? 0 : 1 / (firstRank + 1);
    recallSum += recall; mrrSum += mrr;
    if (recall === 1) perfect++;
    detail.push({ q: r.q, recall: +recall.toFixed(2), top: r.top.join(','), rel: r.rel.join(',') });
  }
  const n = d.results.length;
  rows.push({ файл: f.replace('out-', '').replace('.json', ''), 'recall@5': +(recallSum / n).toFixed(3),
    MRR: +(mrrSum / n).toFixed(3), 'все найдены': `${perfect}/${n}`, 'мс/запись': +d.perChunkMs.toFixed(1) });
  if (process.env.DETAIL) { console.log('\n### ' + f); console.table(detail); }
}
console.table(rows);
