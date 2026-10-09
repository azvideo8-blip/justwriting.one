import { readFileSync, writeFileSync } from 'node:fs';
import MiniSearch from 'minisearch';

const RRF_K = 60, KEYWORD_TOP = 40, RRF_FINAL = 15, RESURFACE_FLOOR = 0.35;

const notes = JSON.parse(readFileSync('corpus-real.json', 'utf8'));
const queries = JSON.parse(readFileSync('queries-real.json', 'utf8'));
const vectorTop = JSON.parse(readFileSync('vector-top.json', 'utf8'));

const ms = new MiniSearch({
  fields: ['title', 'content'],
  storeFields: [],
  searchOptions: { prefix: true, combineWith: 'OR', fuzzy: 0.2 },
});
ms.addAll(notes.map(n => ({ id: n.id, title: n.title, content: n.text.slice(0, 10_000) })));

const shouldBoost = q => /[А-ЯЁ][а-яё]{2,}/.test(q) || /["'«»]/.test(q);

function rrf(vec, kw, k, w) {
  const scores = new Map();
  vec.forEach((r, i) => scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (k + i)));
  kw.forEach((r, i) => scores.set(r.id, (scores.get(r.id) ?? 0) + (1 / (k + i)) * w));
  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

const byId = Object.fromEntries(notes.map(n => [n.id, n]));
const out = queries.map(q => {
  const vec = vectorTop[q];
  const kw = ms.search(q).slice(0, KEYWORD_TOP).map(r => ({ id: r.id, score: r.score }));
  const fused = rrf(vec, kw, RRF_K, shouldBoost(q) ? 2.0 : 1.0);
  const topIds = fused.slice(0, RRF_FINAL).map(f => f.id);

  const vScore = new Map(vec.map(v => [v.id, v.score]));
  const kwIds = new Set(kw.map(k => k.id));
  // отсечка по релевантности, как в продукте
  const filtered = topIds.filter(id => kwIds.has(id) || (vScore.get(id) ?? 0) >= RESURFACE_FLOOR);

  const topScore = vec[0]?.score ?? 0;
  const qLower = q.toLowerCase();
  const exactTitle = filtered.some(id => byId[id].title.toLowerCase().includes(qLower));
  // П-2: обход по косинусу из модели убран вместе с продовой веткой
  // `topScore >= 0.88` (на шкале bge-m3 он не срабатывал ни разу). topScore
  // остаётся в отчёте стенда как замер, а не как решение.
  const bypassed = exactTitle;

  return {
    query: q,
    topScore: +topScore.toFixed(3),
    bypassed,
    bypassReason: exactTitle ? 'exact_title' : null,
    candidates: filtered,
    rrfTop5: filtered.slice(0, 5),
  };
});

writeFileSync('fused.json', JSON.stringify(out, null, 1));
out.forEach(r => console.log(
  `${r.bypassed ? 'ОБХОД ' : '      '} top=${r.topScore}  кандидатов=${r.candidates.length}  ${r.query}`
));
