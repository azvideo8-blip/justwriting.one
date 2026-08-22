const key = process.env.OPENROUTER_API_KEY;
const base = process.env.AI_BASE_URL ?? 'https://routerai.ru/api/v1';
const model = process.env.OPENROUTER_MODEL ?? process.argv[2];
const system = 'Ты — группа психологов разных школ. Разбирай заметки человека глубоко, тепло и без воды. Отвечай по-русски.';
// Синтетическая заметка: по длине и устройству похожа на дневниковую запись
// (счётчик дней, бытовые детали, разбор с ведущим, планы), но выдумана целиком.
// Живые записи в репозиторий не попадают — см. .gitignore и AGENTS.md.
// Числа в docs/ мерились на личной записи похожего объёма; при сравнении
// прогонов перемеряй на одном и том же тексте.
const note = `Практика 4, день 11. Вчера пропустил — с утра правил приложение, потом две встречи подряд без перерыва, к вечеру не осталось сил. Ну и ладно.
Сосед опять затеял ремонт с восьми утра, весь день фоном перфоратор.
На разборе вытащили конструкцию: осторожная часть пугается, когда любопытная берётся за неразрешённое, и на этом интерес глохнет. Когда осторожная часть выдыхается — срыв, десять часов за экраном, ложусь под утро. После чего она же говорит: вот видишь, без присмотра нельзя.
Ведущий сказал, что конструкция растёт из привычки быть удобным. Выход — поставить на место надзирателя собственную опору. Я берегу себя сам, а не из страха получить по шапке.
На следующей неделе останусь один. Надо держать режим, готовить себе завтрак, ходить пешком, дойти наконец до врача. Тут нужен будет какой-то волевой шаг.
Отказался от вечерних встреч — вечера заняты. Предложил утро, собеседник выбрал субботу. Тут я уже сделал как хотел.`;

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
