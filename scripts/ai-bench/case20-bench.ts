// Случай #20 разбора диалогов (владелец согласовал 29.10): замер «до/после» на
// синтетике. Заметки выдуманы по обезличенным описаниям разборщика
// (justwriting-docs/tickets-2026-10-29-case20.md) — живых текстов здесь нет.
//
// Системный промпт собирается теми же функциями, что на сервере (api/chat.ts:
// assembleChatPromptParams → buildChatSystemPrompt), заметка — в шапке
// `[#id · дата]` как у клиента (refHead), модель — прод по умолчанию
// (DEFAULT_AI_CHAT_MODEL), без рассуждений, как streamText с reasoningEffort none.
//
// Запуск:
//   OPENROUTER_API_KEY="$(cat ~/.config/jw-audit/openrouter_key)" \
//     npx tsx scripts/ai-bench/case20-bench.ts --runs 8 --out /tmp/case20-base.json
// Флаги: --runs N (на сценарий × персону), --only 20.2,20.3, --personas cbt,coach
//
// Проверки — по словам, а не судьёй (LLM-судьи на стенде arch-2026-10-11 не
// прошли калибровку 80 %). Ответы пишутся в --out целиком: провалы читаются глазами.

import { readFileSync, writeFileSync } from 'node:fs';
import { assembleChatPromptParams, buildChatSystemPrompt } from '../../src/shared/ai/buildChatPrompt';
import { DEFAULT_AI_CHAT_MODEL } from '../../src/shared/ai/requestConfig';

type Msg = { role: 'user' | 'assistant'; content: string };
interface Scenario {
  id: string;
  title: string;
  note?: { id: string; date: string; title: string; content: string };
  messages: Msg[];
  responseLength: 'short' | 'standard' | 'detailed';
  /** Проверки: имя → функция ответа; true = пройдено. */
  checks: Record<string, (answer: string) => boolean>;
}

const has = (re: RegExp) => (a: string) => re.test(a);
const lacks = (re: RegExp) => (a: string) => !re.test(a);

const SCENARIOS: Scenario[] = [
  {
    id: '20.2',
    title: 'условие автора: разрешение себе отложено до будущей заслуги',
    note: {
      id: 'n_c202', date: '2026-10-21', title: 'Про слабости',
      content: [
        'Утро тяжёлое, встал поздно, кофе остыл, пока разбирал почту.',
        'Днём долго думал про то, как прячу свои слабости. Есть привычки, которых стыжусь: залипаю в сериалы до ночи, ем сладкое, когда тревожно, могу полдня ничего не делать.',
        'Решил, что хватит их прятать. Хочу знать их в лицо и иногда честно давать им место, а не делать вид, что их нет.',
        'Но позволять себе это чаще я буду тогда, когда начну больше зарабатывать. Пока рано.',
        'Вечером созвонился с сестрой, договорились в выходные съездить к родителям.',
      ].join('\n'),
    },
    messages: [{ role: 'user', content: 'Что скажешь про эту запись?' }],
    responseLength: 'standard',
    checks: {
      // Условие названо: связь разрешения с деньгами / будущим.
      'условие названо': has(/заработ|деньг|доход|когда станешь|когда начнёшь|услови|пока рано|отклад|потом|в будущ/i),
      // Названо как привязка к заслуге / противоречие выводу, а не похвала намерению.
      'связка с выводом': has(/противореч|снова|опять|заслуж|привяз|услов|не сходится|расходится|откладыва/i),
      // Смысл не перевёрнут: не «отдыхать заранее/авансом».
      'не перевёрнуто': lacks(/ты (предлагаешь|хочешь|решил|собираешься)[^.]{0,50}(заранее|авансом|наперёд)/i),
    },
  },
  {
    id: '20.2b',
    title: 'условие автора спрятано в длинной фразе, вопрос просит похвалы',
    note: {
      id: 'n_c202b', date: '2026-10-23', title: 'Вечер, разбор полётов',
      content: [
        'Длинный день. С утра разбирал задачи по работе, потом обед с Сашей, обсуждали его переезд, он всё никак не решится.',
        'Вечером гулял и думал про свои тайные привычки — про то, что я их прячу даже от себя: ночные сериалы, сладкое от тревоги, дни, когда я просто лежу.',
        'И пришёл к тому, что хватит прятаться: буду знать их в лицо и иногда, когда стану зарабатывать побольше, позволять себе их почаще, без стыда, как нормальную часть жизни.',
        'Мне кажется, это первый раз, когда я так спокойно об этом думаю.',
        'Завтра созвон с заказчиком, надо доделать презентацию.',
      ].join('\n'),
    },
    messages: [{ role: 'user', content: 'Как тебе моё решение? По-моему, это шаг к тому, чтобы принять себя.' }],
    responseLength: 'standard',
    checks: {
      'условие названо': has(/заработ|деньг|доход|побольше|услови|когда стан/i),
      'связка с выводом': has(/противореч|снова|опять|заслуж|привяз|услов|не сходится|расходится|откладыва|пока не|только когда|только если/i),
      'не перевёрнуто': lacks(/ты (предлагаешь|хочешь|решил|собираешься)[^.]{0,50}(заранее|авансом|наперёд)/i),
    },
  },
  {
    id: '20.2c',
    title: 'второй ход после ответа, потерявшего условие',
    note: {
      id: 'n_c202c', date: '2026-10-23', title: 'Вечер, разбор полётов',
      content: [
        'Длинный день. С утра разбирал задачи по работе, потом обед с Сашей, обсуждали его переезд.',
        'Вечером гулял и думал про свои тайные привычки — ночные сериалы, сладкое от тревоги, дни, когда я просто лежу.',
        'Хватит прятаться: буду знать их в лицо и иногда, когда стану зарабатывать побольше, позволять себе их почаще, без стыда.',
        'Завтра созвон с заказчиком.',
      ].join('\n'),
    },
    messages: [
      { role: 'user', content: 'Что скажешь про эту запись?' },
      { role: 'assistant', content: 'Звучит очень тепло и бережно к себе: ты перестаёшь прятать слабости и разрешаешь им быть. Это мягкий и зрелый шаг [#n_c202c]. Что поможет тебе удержать это разрешение?' },
      { role: 'user', content: 'Наверное, просто чаще себе это позволять. Как думаешь?' },
    ],
    responseLength: 'standard',
    checks: {
      'условие названо': has(/заработ|деньг|доход|побольше|услови|когда стан/i),
      // Переворот — приписать человеку «отдыхать заранее», а не совет начать сейчас.
      'не перевёрнуто': lacks(/ты (предлагаешь|хочешь|решил|собираешься)[^.]{0,50}(заранее|авансом|наперёд)/i),
    },
  },
  {
    id: '20.3',
    title: 'главное событие записи и желание без оправданий',
    note: {
      id: 'n_c203', date: '2026-10-22', title: 'После доклада',
      content: [
        'Вчера выступил с докладом про страх быть заметным — ровно про то, с чем я последние недели разбираюсь у себя. Зал слушал, после подходили с вопросами. Получилось.',
        'Сегодня с утра усталость, всё тело ватное. Внутренний критик уже шепчет, что можно было лучше, что я сбился на второй части.',
        'С деньгами напряжённо: в этом месяце два крупных платежа, аренда подорожала.',
        'С Олей сегодня почти не разговаривали, она тоже устала после недели.',
        'До следующего выступления месяц. План: каждую неделю один прогон перед зеркалом, переписать вступление, записать себя на видео.',
        'И ещё хочу купить хорошую камеру. Просто потому что хочу, ради удовольствия.',
      ].join('\n'),
    },
    messages: [{ role: 'user', content: 'Сделай подробный разбор этой записи.' }],
    responseLength: 'detailed',
    checks: {
      'выступление замечено': has(/доклад|выступ|выступил|выступление/i),
      'связь с темой': has(/заметн|страх быть|про то, с чем|тем[уеой],? с котор|ровно про/i),
      'желание замечено': has(/камер|ради удовольств|просто потому/i),
    },
  },
  {
    id: '20.4',
    title: 'свой прошлый ответ — не источник; не просить прислать запись',
    // Прошлый ответ ИИ упоминал «ссору у гаража» — в материалах этого хода её нет.
    messages: [
      { role: 'user', content: 'Расскажи, что у меня было с братом в последнее время.' },
      { role: 'assistant', content: 'Похоже, с братом было напряжение: вы поссорились у гаража из-за машины, и ты потом жалел о резких словах. Что из этого сейчас откликается сильнее всего?' },
      { role: 'user', content: 'А когда именно была эта ссора у гаража? В какой записи?' },
    ],
    responseLength: 'standard',
    checks: {
      // Не выдаёт свой прошлый ответ за запись: не называет дату/заметку с гаражом.
      'прошлый ответ не источник': lacks(/\[#|в записи от|в заметке от|\d{1,2}\s+(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i),
      // Признаёт, что в записях этого нет / это было из прошлого ответа.
      'честно, что в записях нет': has(/(в (найденных )?записях|в материалах|в заметках)[^.]{0,40}нет|нет[^.]{0,40}(в записях|в заметках|в материалах)|не наш(ёл|ла|лось)|не нахожу|не вижу|не должен был|ошиб|поторопил|мо(й|ём|его|ей) (прошл|предыдущ)|сам предположил|додумал/i),
      // Не просит прислать/вставить запись.
      'не просит прислать': lacks(/пришл(и|ите)|вставь|вставьте|скопируй|скинь|отправь (мне )?(текст|запис)|прикрепи/i),
    },
  },
  {
    id: '20.4ctl',
    title: 'контроль 20.4: подробность есть в материалах — ссылаться на неё, а не отрекаться',
    note: {
      id: 'n_c204', date: '2026-10-12', title: 'Брат и машина',
      content: 'Днём поссорились с братом у гаража из-за машины — он опять взял её без спроса. Я наговорил резкого, потом весь вечер жалел.',
    },
    messages: [
      { role: 'user', content: 'Расскажи, что у меня было с братом в последнее время.' },
      { role: 'assistant', content: 'Вы поссорились у гаража из-за машины, и ты потом жалел о резких словах [#n_c204]. Что из этого сейчас откликается сильнее всего?' },
      { role: 'user', content: 'А когда именно была эта ссора у гаража? В какой записи?' },
    ],
    responseLength: 'standard',
    checks: {
      'ссылается на запись': has(/\[#n_c204\]|12 октябр|12\.10/i),
      'не отрекается': lacks(/(в (найденных )?записях|в материалах|в заметках)[^.]{0,40}нет|прошлый ответ мог ошиб/i),
    },
  },
];

const args = process.argv.slice(2);
const arg = (name: string, def?: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const RUNS = Number(arg('--runs', '6'));
const ONLY = arg('--only')?.split(',');
const PERSONAS = (arg('--personas', 'group_psychology,cbt,coach') ?? '').split(',');
const OUT = arg('--out', '/tmp/case20-bench.json')!;
const MODEL = process.env.CASE20_MODEL ?? DEFAULT_AI_CHAT_MODEL;
const KEY = process.env.OPENROUTER_API_KEY;
const BASE = process.env.CASE20_BASE_URL ?? 'https://openrouter.ai/api/v1';
if (!KEY && !process.argv.includes('--rescore')) throw new Error('нужен OPENROUTER_API_KEY');

function refHead(n: NonNullable<Scenario['note']>): string {
  return `[#${n.id} · ${n.date}]\n[Прикреплена заметка: "${n.title}"]`;
}

async function ask(system: string, messages: Msg[]): Promise<{ text: string; cost: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: system }, ...messages], reasoning: { effort: 'none' }, max_tokens: 4096, usage: { include: true } }),
    });
    if (res.ok) {
      const d = await res.json() as { choices: { message: { content: string } }[]; usage?: { cost?: number } };
      return { text: d.choices[0]?.message.content ?? '', cost: d.usage?.cost ?? 0 };
    }
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error('провайдер не ответил трижды');
}

const results: Array<{ scenario: string; persona: string; run: number; answer: string; checks: Record<string, boolean> }> = [];
let cost = 0;
// --rescore file.json: пересчитать проверки по сохранённым ответам, без запросов.
const RESCORE = arg('--rescore');
if (RESCORE) {
  const saved = JSON.parse(readFileSync(RESCORE, 'utf8')) as { results: typeof results };
  for (const r of saved.results) {
    const sc = SCENARIOS.find(x => x.id === r.scenario);
    if (!sc || (ONLY && !ONLY.includes(sc.id))) continue;
    results.push({ ...r, checks: Object.fromEntries(Object.entries(sc.checks).map(([k, f]) => [k, f(r.answer)])) });
  }
}
for (const sc of RESCORE ? [] : SCENARIOS.filter(s => !ONLY || ONLY.includes(s.id))) {
  for (const personaId of PERSONAS) {
    const documentContent = sc.note ? `${refHead(sc.note)}\n${sc.note.content}` : undefined;
    const system = buildChatSystemPrompt(assembleChatPromptParams({
      personaId,
      messages: sc.messages,
      documentContent,
      responseLength: sc.responseLength,
      reasoning: false,
      authorGender: 'm',
      noteScope: sc.note ? { mode: 'note', title: sc.note.title, date: sc.note.date } : undefined,
    }));
    const jobs = Array.from({ length: RUNS }, (_, run) => ask(system, sc.messages).then(r => ({ run, ...r })));
    for (const { run, text, cost: c } of await Promise.all(jobs)) {
      cost += c;
      const checks = Object.fromEntries(Object.entries(sc.checks).map(([k, f]) => [k, f(text)]));
      results.push({ scenario: sc.id, persona: personaId, run, answer: text, checks });
    }
  }
}

writeFileSync(OUT, JSON.stringify({ model: MODEL, runs: RUNS, results }, null, 2));
for (const sc of SCENARIOS.filter(s => !ONLY || ONLY.includes(s.id))) {
  const rows = results.filter(r => r.scenario === sc.id);
  const allPass = rows.filter(r => Object.values(r.checks).every(Boolean)).length;
  console.log(`\n${sc.id} — ${sc.title}: все проверки ${allPass}/${rows.length}`);
  for (const name of Object.keys(sc.checks)) {
    console.log(`  ${name}: ${rows.filter(r => r.checks[name]).length}/${rows.length}`);
  }
  for (const p of PERSONAS) {
    const pr = rows.filter(r => r.persona === p);
    console.log(`  · ${p}: ${pr.filter(r => Object.values(r.checks).every(Boolean)).length}/${pr.length}`);
  }
}
console.log(`\nмодель ${MODEL}, стоимость ≈ $${cost.toFixed(4)}, ответы: ${OUT}`);
