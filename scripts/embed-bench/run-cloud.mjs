import { readFileSync, writeFileSync } from 'node:fs';
const corpus = JSON.parse(readFileSync('corpus.json', 'utf8'));
const queries = JSON.parse(readFileSync('queries.json', 'utf8'));
const key = process.env.OPENROUTER_API_KEY;
const base = process.env.AI_BASE_URL ?? 'https://routerai.ru/api/v1';
const model = process.env.OPENROUTER_EMBED_MODEL ?? 'qwen/qwen3-embedding-8b';
if (!key) { console.error('нет ключа'); process.exit(1); }

async function embed(texts) {
  const t = Date.now();
  const r = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!r.ok) { console.error('HTTP', r.status, (await r.text()).slice(0, 200)); process.exit(1); }
  const j = await r.json();
  return { vecs: j.data.map(d => d.embedding), ms: Date.now() - t };
}

const d = await embed(corpus.map(e => e.text));
const q = await embed(queries.map(x => x.q));
const norm = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
const docVecs = {}; corpus.forEach((e, i) => docVecs[e.id] = norm(d.vecs[i]));
const qv = q.vecs.map(norm);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const results = queries.map((x, i) => ({
  q: x.q, rel: x.rel,
  top: Object.entries(docVecs).map(([id, v]) => ({ id, score: dot(qv[i], v) }))
    .sort((a, b) => b.score - a.score).slice(0, 5).map(r => r.id),
}));
writeFileSync('out-cloud-qwen.json', JSON.stringify({
  modelId: model, dim: d.vecs[0].length, loadMs: 0,
  perChunkMs: d.ms / corpus.length, networkMs: d.ms, results }, null, 1));
console.log(`${model}: dim=${d.vecs[0].length} партия из ${corpus.length} за ${d.ms}мс`);
