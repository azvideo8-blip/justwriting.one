import { pipeline } from '@huggingface/transformers';
import { readFileSync, writeFileSync } from 'node:fs';

const corpus = JSON.parse(readFileSync('corpus.json', 'utf8'));
const queries = JSON.parse(readFileSync('queries.json', 'utf8'));
const modelId = process.argv[2];
const usePrefix = process.argv[3] === 'prefix';

const t0 = Date.now();
const extract = await pipeline('feature-extraction', modelId, { dtype: process.env.DTYPE || 'q8' });
const loadMs = Date.now() - t0;

const embed = async (text) => {
  const out = await extract(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
};

// Замер скорости: прогрев, затем 45 записей подряд.
await embed('прогрев');
const tPass = Date.now();
const docVecs = {};
for (const e of corpus) docVecs[e.id] = await embed(usePrefix ? `passage: ${e.text}` : e.text);
const perChunkMs = (Date.now() - tPass) / corpus.length;

const qVecs = [];
for (const q of queries) qVecs.push(await embed(usePrefix ? `query: ${q.q}` : q.q));

const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const results = queries.map((q, i) => ({
  q: q.q,
  rel: q.rel,
  top: Object.entries(docVecs)
    .map(([id, v]) => ({ id, score: dot(qVecs[i], v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(r => r.id),
}));

const tag = `${modelId.split("/")[1]}-${usePrefix ? "prefix" : "noprefix"}-${process.env.DTYPE || "q8"}`;
writeFileSync(`out-${tag}.json`,
  JSON.stringify({ modelId, dim: docVecs[corpus[0].id].length, loadMs, perChunkMs, results }, null, 1));
console.log(`${modelId}: dim=${docVecs[corpus[0].id].length} загрузка=${loadMs}мс на запись=${perChunkMs.toFixed(1)}мс`);
