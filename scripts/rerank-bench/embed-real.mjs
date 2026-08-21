import { readFileSync, writeFileSync } from 'node:fs';
const key = process.env.OPENROUTER_API_KEY;
const base = process.env.AI_BASE_URL ?? 'https://routerai.ru/api/v1';
const model = process.env.OPENROUTER_EMBED_MODEL ?? 'qwen/qwen3-embedding-8b';

const CHUNK_CHAR_LIMIT = 1000, CHUNK_OVERLAP = 150, MAX_CHUNKS = 200;
function chunkText(text) {
  if (text.length <= CHUNK_CHAR_LIMIT) return [text];
  const chunks = []; let start = 0;
  while (start < text.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(start + CHUNK_CHAR_LIMIT, text.length);
    if (end < text.length) {
      const ls = text.lastIndexOf(' ', end);
      if (ls > start + CHUNK_CHAR_LIMIT / 2) end = ls;
    }
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks.filter(c => c.length > 0);
}

async function embed(texts) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
    });
    if (r.ok) return (await r.json()).data.map(d => d.embedding);
    const body = (await r.text()).slice(0, 200);
    console.error(`попытка ${attempt}: HTTP ${r.status} ${body}`);
    if (attempt === 3) process.exit(1);
    await new Promise(res => setTimeout(res, 2000 * attempt));
  }
}
const norm = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

const notes = JSON.parse(readFileSync('/tmp/corpus-real.json', 'utf8'));
const queries = JSON.parse(readFileSync('/tmp/queries-real.json', 'utf8'));

// векторы заметок: по кускам, как в продукте
const noteVecs = [];
let done = 0;
for (const note of notes) {
  const chunks = chunkText(note.text);
  const vecs = [];
  for (let i = 0; i < chunks.length; i += 32) {
    vecs.push(...(await embed(chunks.slice(i, i + 32))).map(norm));
  }
  noteVecs.push({ id: note.id, vectors: vecs });
  if (++done % 25 === 0) console.error(`  посчитано заметок: ${done}/${notes.length}`);
}

const qVecs = (await embed(queries)).map(norm);

// векторный топ-40, лучший кусок в заметке — как topKMultiWithChunkIndex
const out = {};
queries.forEach((q, qi) => {
  const scored = noteVecs.map(item => {
    let best = 0, bestIdx = 0;
    item.vectors.forEach((v, i) => { const s = dot(qVecs[qi], v); if (s > best) { best = s; bestIdx = i; } });
    return { id: item.id, score: best, chunkIndex: bestIdx };
  });
  scored.sort((a, b) => b.score - a.score);
  out[q] = scored.slice(0, 40);
});
writeFileSync('/tmp/vector-top.json', JSON.stringify(out));
console.error('готово: /tmp/vector-top.json');
