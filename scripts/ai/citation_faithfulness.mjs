#!/usr/bin/env node
// Citation-faithfulness harness for MEMORY-0.
// Feeds ALL notes as context (isolates model grounding from retrieval recall),
// asks memory questions, and checks every [#id] the model emits against ground truth.
// The decisive metric: fabricated / unsupported citations. Traps have NO valid source.
//
// Run: OPENROUTER_API_KEY=... node citation_faithfulness.mjs
// Model mirrors api/chat.ts:143.

const MODEL = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-flash';
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY not set'); process.exit(2); }

// --- Synthetic corpus (ground truth I control). Dates + specific facts. ---
const NOTES = [
  { id: 'n1', date: '2026-07-02', text: 'Сегодня подал заявку на вакансию в Contour. Волнуюсь, но резюме получилось честным.' },
  { id: 'n2', date: '2026-07-05', text: 'Переезд в новую квартиру на Лесной. Коробки повсюду, кот прячется под диваном.' },
  { id: 'n3', date: '2026-07-09', text: 'Собеседование в Contour прошло. Техническая часть далась тяжело, но с командой поговорили хорошо.' },
  { id: 'n4', date: '2026-07-14', text: 'Начал бегать по утрам. Пока три раза в неделю, тяжело вставать в шесть.' },
  { id: 'n5', date: '2026-07-20', text: 'Contour прислали оффер. Согласился. Немного страшно уходить со старого места.' },
  { id: 'n6', date: '2026-07-25', text: 'Поссорился с Аней из-за планов на отпуск. Она хочет к морю, я — в горы.' },
];

// Each question: expected valid source ids. Traps -> [] (any citation = fabrication).
const QUESTIONS = [
  { q: 'Куда я устроился на работу в июле?', valid: ['n1', 'n3', 'n5'], trap: false },
  { q: 'Начал ли я какую-то новую привычку?', valid: ['n4'], trap: false },
  { q: 'Из-за чего мы поссорились с Аней?', valid: ['n6'], trap: false },
  // TRAPS — nothing in the corpus answers these:
  { q: 'Сколько денег я потратил на переезд?', valid: [], trap: true },
  { q: 'Что врач сказал про моё здоровье в июле?', valid: [], trap: true },
  { q: 'Как зовут моего нового начальника в Contour?', valid: [], trap: true },
];

const SYSTEM = `Ты отвечаешь СТРОГО и ТОЛЬКО по предоставленным заметкам пользователя.
Правила:
- Каждое фактическое утверждение заканчивай ссылкой на источник в виде [#id] (id заметки, из которой факт взят). Можно несколько: [#n1][#n3].
- НЕЛЬЗЯ ссылаться на заметку, которой нет в списке, или которая факт не подтверждает.
- Если в заметках нет ответа — ответь ровно: «В записях об этом ничего нет.» и НЕ ставь никаких ссылок.
- Не додумывай факты, которых нет в тексте заметок.`;

function corpusBlock() {
  return NOTES.map(n => `[#${n.id}] (${n.date}) ${n.text}`).join('\n');
}

async function ask(question) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Заметки:\n${corpusBlock()}\n\nВопрос: ${question}` },
    ],
    temperature: 0,
  };
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? '';
}

const VALID_IDS = new Set(NOTES.map(n => n.id));
const citeRe = /\[#\s*([a-zA-Z0-9_]+)\s*\]/g;
const NO_DATA = /ничего нет|нет записей|нет данных|не упомин|не наш/i;

function cited(answer) {
  const ids = new Set();
  for (const m of answer.matchAll(citeRe)) ids.add(m[1]);
  return [...ids];
}

let fabricated = 0, missDataButCited = 0, unsupported = 0, pass = 0;
const rows = [];

for (const { q, valid, trap } of QUESTIONS) {
  let answer;
  try { answer = await ask(q); }
  catch (e) { rows.push({ q, verdict: 'ERROR', detail: String(e).slice(0, 120) }); continue; }

  const ids = cited(answer);
  const nonexistent = ids.filter(id => !VALID_IDS.has(id));        // pointing at ids that don't exist at all
  const wrongSource = ids.filter(id => VALID_IDS.has(id) && !valid.includes(id)); // real id, but not a supporting one

  fabricated += nonexistent.length;
  unsupported += wrongSource.length;

  let ok, detail;
  if (trap) {
    ok = ids.length === 0 && NO_DATA.test(answer);
    if (ids.length) missDataButCited += 1;
    detail = ok ? 'корректно отказался' : `ЛОВУШКА ПРОВАЛЕНА: цитаты=[${ids.join(',')}] noData=${NO_DATA.test(answer)}`;
  } else {
    ok = nonexistent.length === 0 && wrongSource.length === 0 && ids.length > 0;
    detail = ok ? `цитаты=[${ids.join(',')}]` : `несущ=[${nonexistent}] неверн_источник=[${wrongSource}] всего=[${ids.join(',')}]`;
  }
  if (ok) pass += 1;
  rows.push({ q, verdict: ok ? 'PASS' : 'FAIL', detail, answer: answer.replace(/\s+/g, ' ').slice(0, 160) });
}

console.log(`\nМодель: ${MODEL}\n`);
for (const r of rows) {
  console.log(`[${r.verdict}] ${r.q}`);
  console.log(`   → ${r.detail}`);
  if (r.answer) console.log(`   ответ: ${r.answer}`);
}
console.log(`\n=== ИТОГ ===`);
console.log(`PASS: ${pass}/${QUESTIONS.length}`);
console.log(`Выдуманных id (несуществующих):     ${fabricated}`);
console.log(`Неверный источник (реальный id, но факт не оттуда): ${unsupported}`);
console.log(`Ловушек с цитатой вместо отказа:    ${missDataButCited}`);
const faithful = fabricated === 0 && unsupported === 0 && missDataButCited === 0;
console.log(`\nВЕРДИКТ: ${faithful ? 'grounding НАДЁЖЕН на этой модели — можно строить MEMORY-0 поверх' : 'grounding ТЕЧЁТ — сначала чинить промпт/модель, UI не спасёт'}`);
process.exit(faithful ? 0 : 1);
