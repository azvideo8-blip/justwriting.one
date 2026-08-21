import { readFileSync, writeFileSync } from 'node:fs';
const key = process.env.OPENROUTER_API_KEY;
const base = process.env.AI_BASE_URL ?? 'https://routerai.ru/api/v1';
const model = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-flash';

const SYSTEM = `Ты — точный ранжировщик личных заметок. Тебе дан запрос пользователя и список заметок-кандидатов.
Верни только JSON вида {"ids":["docId", ...]} с идентификаторами самых релевантных заметок, от самой релевантной к менее.
Никаких пояснений.`;

const notes = Object.fromEntries(JSON.parse(readFileSync('/tmp/corpus-real.json','utf8')).map(n => [n.id, n]));
const fused = JSON.parse(readFileSync('/tmp/fused.json','utf8'));

const out = [];
for (const row of fused) {
  const cards = row.candidates.map((id, i) => {
    const n = notes[id];
    return `[${i + 1}] docId=${id}\n${n.title}\n${n.text.slice(0, 600)}`;
  }).join('\n\n');

  const t = Date.now();
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Запрос пользователя: "${row.query}"\n\nКандидаты-заметки:\n${cards}\n\nВыбери до 5 самых релевантных. Верни только {"ids":[...]}.` },
      ],
      max_tokens: 512,
      reasoning_effort: 'none',
    }),
  });
  const ms = Date.now() - t;
  if (!r.ok) { console.error(`${row.query}: HTTP ${r.status}`); out.push({ ...row, rerankTop5: null, ms, failed: true }); continue; }
  const j = await r.json();
  let txt = (j.choices?.[0]?.message?.content ?? '').trim();
  if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  let ids = [];
  try { const o = JSON.parse(txt); if (Array.isArray(o.ids)) ids = o.ids.filter(x => typeof x === 'string'); } catch { /* ignore */ }
  const valid = ids.filter(id => row.candidates.includes(id)).slice(0, 5);
  out.push({ ...row, rerankTop5: valid.length ? valid : null, ms, failed: valid.length === 0 });
  console.error(`${row.query}: ${valid.length ? valid.join(',') : 'ОТКАЗ'}  ${ms}мс`);
}
writeFileSync('/tmp/reranked.json', JSON.stringify(out, null, 1));
