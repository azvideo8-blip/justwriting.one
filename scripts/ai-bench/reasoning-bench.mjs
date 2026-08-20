const key = process.env.OPENROUTER_API_KEY;
const base = process.env.AI_BASE_URL ?? 'https://routerai.ru/api/v1';
const model = process.env.OPENROUTER_MODEL ?? process.argv[2];
const system = 'Ты — группа психологов разных школ. Разбирай заметки человека глубоко, тепло и без воды. Отвечай по-русски.';
const note = `[запись удалена]
[запись удалена]
[запись удалена]
[запись удалена]
[запись удалена]
[запись удалена]`;

const variants = [
  { name: 'сейчас: effort high', body: { reasoning: { effort: 'high' } } },
  { name: 'effort medium',       body: { reasoning: { effort: 'medium' } } },
  { name: 'effort low',          body: { reasoning: { effort: 'low' } } },
  { name: 'reasoning_effort none', body: { reasoning_effort: 'none' } },
];

for (const v of variants) {
  const t = Date.now();
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: `Разбери пожалуйста глубоко эту заметку.\n\n${note}` }],
      max_tokens: 16384,
      ...v.body,
    }),
  });
  if (!r.ok) { console.log(`${v.name}: HTTP ${r.status} ${(await r.text()).slice(0,120)}`); continue; }
  const j = await r.json();
  const m = j.choices?.[0]?.message ?? {};
  const think = m.reasoning_content ?? m.reasoning ?? '';
  const u = j.usage ?? {};
  console.log([
    v.name.padEnd(24),
    `рассуждение ${String(think.length).padStart(6)} зн.`,
    `ответ ${String((m.content||'').length).padStart(6)} зн.`,
    `токенов вход ${String(u.prompt_tokens ?? '?').padStart(5)}`,
    `выход ${String(u.completion_tokens ?? '?').padStart(5)}`,
    `${((Date.now()-t)/1000).toFixed(1)} с`,
  ].join('  '));
}
