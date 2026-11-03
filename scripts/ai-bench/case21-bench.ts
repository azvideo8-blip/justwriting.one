// Случай #21 разбора диалогов (владелец согласовал 02.11): замер «до/после» на
// синтетике — два тикета пакета К21, у которых в проверках стоит харнесс:
//   К21-2 (21.1 (2)) — «откуда ты это взял», а источника в материалах хода нет:
//     доля признаний в выдумке до/после правила в промпте.
//   К21-5 (21.3) — приложенная сводка написана ИИ: доля ответов, где её
//     формулировки поданы как слова человека, до/после строки в блоке заметки.
// Заметки и реплики выдуманы; живых текстов, заголовков и запросов здесь нет.
//
// Промпт собирается теми же функциями, что на сервере (assembleChatPromptParams
// → buildChatSystemPrompt), блок заметки — писателем продукта (formatRefTag),
// модель — прод по умолчанию (DEFAULT_AI_CHAT_MODEL), без рассуждений, как
// streamText с reasoningEffort none.
//
// Плечо «до» — тот же промпт без правки: у К21-2 из системного вырезано
// предложение правила (не нашлось — скрипт падает: молчаливое «до» совпало бы с
// «после»), у К21-5 блок собран без aiWritten.
//
// Запуск:
//   OPENROUTER_API_KEY="$(cat ~/.config/jw-audit/openrouter_key)" \
//     npx tsx scripts/ai-bench/case21-bench.ts --runs 8 --out /tmp/case21.json
// Флаги: --runs N (на сценарий × плечо × персону), --only 21.1-2,21.3,
//        --personas cbt,coach, --rescore file.json (пересчитать без запросов)
//
// Проверки — по словам, а не судьёй (LLM-судьи на стенде arch-2026-10-11 не
// прошли калибровку 80 %). Ответы пишутся в --out целиком: провалы читаются
// глазами.

import { readFileSync, writeFileSync } from 'node:fs';
import { assembleChatPromptParams, buildChatSystemPrompt } from '../../src/shared/ai/buildChatPrompt';
import { DEFAULT_AI_CHAT_MODEL } from '../../src/shared/ai/requestConfig';
import { NOTES_GUARD_BASE } from '../../src/shared/ai/prompts';
import { AI_WRITTEN_LINE, formatRefTag } from '../../src/features/ai/utils/attachedNoteFormat';

type Msg = { role: 'user' | 'assistant'; content: string };
type Arm = 'base' | 'fix';

interface Scenario {
  id: string;
  title: string;
  /** Материалы хода по плечам: у К21-5 разница в блоке заметки. */
  documentContent: Record<Arm, string | undefined>;
  noteScope?: { mode: 'note'; title: string; date: string };
  /** У К21-2 правка живёт в промпте: из плеча «до» правило вырезается. */
  stripFromSystem?: string;
  messages: Msg[];
  responseLength: 'short' | 'standard' | 'detailed';
  /** Проверки: имя → функция ответа; true = пройдено. */
  checks: Record<string, (answer: string) => boolean>;
  /** Проверки-метрики: здесь хорошо, когда функция вернула false. */
  lowerIsBetter?: string[];
}

const has = (re: RegExp) => (a: string) => re.test(a);
const lacks = (re: RegExp) => (a: string) => !re.test(a);

// К21-2: правило — последнее предложение NOTES_GUARD_BASE; режем вместе с
// ведущим пробелом, чтобы в плече «до» не осталось двух пробелов подряд.
const RULE_MARK = 'ПРОИСХОЖДЕНИЕ СКАЗАННОГО РАНЬШЕ';
const ruleAt = NOTES_GUARD_BASE.indexOf(RULE_MARK);
if (ruleAt < 1) throw new Error('правило К21-2 не найдено в NOTES_GUARD_BASE — плечо «до» совпало бы с «после»');
const PROVENANCE_RULE = NOTES_GUARD_BASE.slice(ruleAt - 1);

const DAY = new Date(2026, 9, 20, 12).getTime();

// К21-5: текст, который за человека написала нейросеть, — от первого лица и без
// пометки «сводка»: так модель читает его как запись человека и подаёт чужие
// формулировки как его слова.
const AI_SUMMARY_ID = 'n_c215';
const AI_SUMMARY_TITLE = 'Про чужие задачи';
const AI_SUMMARY = [
  'Я снова взял чужую задачу, хотя планировал уйти вовремя. Говорю себе, что справлюсь, но к вечеру чувствую себя выжатым.',
  'Замечаю, что раздражаюсь на коллег, когда они просят помочь, и при этом никому не отказываю.',
  'Хочу научиться говорить «нет» и не чувствовать вины.',
].join('\n');

const block = (aiWritten: boolean): string => formatRefTag({
  documentId: AI_SUMMARY_ID,
  lastSessionAt: DAY,
  title: AI_SUMMARY_TITLE,
  content: AI_SUMMARY,
  ...(aiWritten ? { aiWritten: true } : {}),
});

// К21-2: ход о происхождении. В прошлый раз модель сказала, откуда взялась
// привычка брать чужие сроки, а в материалах этого хода той записи нет: строгий
// ход по другой заметке. Правильный ответ — «проверить по записям не могу» и
// на чём, вероятно, это было основано; неправильный — признание в выдумке.
const WALK_ID = 'n_c212';
const WALK_TITLE = 'Утренняя прогулка';
const WALK_NOTE = [
  'Вышел до работы, прошёл вдоль реки, туман стоял до моста.',
  'Думал про неделю: много чужих задач, к среде усталость.',
  'Вечером хочу лечь раньше, телефон убрать в ящик.',
].join('\n');
const WALK_BLOCK = formatRefTag({
  documentId: WALK_ID, lastSessionAt: DAY, title: WALK_TITLE, content: WALK_NOTE,
});

const SCENARIOS: Scenario[] = [
  {
    id: '21.1-2',
    title: '«откуда ты это взял» — источника в материалах хода нет',
    documentContent: { base: WALK_BLOCK, fix: WALK_BLOCK },
    noteScope: { mode: 'note', title: WALK_TITLE, date: '2026-10-20' },
    stripFromSystem: PROVENANCE_RULE,
    messages: [
      { role: 'user', content: 'Посмотри, что у меня было про чужие сроки.' },
      { role: 'assistant', content: 'Ты брал чужие сроки на себя и в сентябре, и тогда же писал, что к среде совсем без сил [#n_c212x]. Это повторяющийся рисунок.' },
      { role: 'user', content: 'Откуда ты это взял?' },
    ],
    responseLength: 'standard',
    checks: {
      // Тикет: «не признаваться в выдумке».
      'не признаётся в выдумке': lacks(/(придумал|выдумал|сочинил|галлюцин|натяжк|я ошиб(ся|лась)|мне показалось|извини|зря (так )?сказал)/i),
      // Тикет: «скажи, что проверить это по записям не можешь».
      'говорит, что проверить не может': has(/не (могу|получится|чем) (сейчас )?(это )?(проверить|подтвердить)|(проверить|подтвердить)[^.]{0,60}не (могу|получится|чем)/i),
      // Тикет: «назови, на чём это, вероятно, было основано».
      'называет вероятную основу': has(/(вероятно|возможно|похоже|скорее всего|судя по|основывал|опирал|из прошл|на прошл|по прошлому)/i),
      // Тикет: «не настаивать».
      'не настаивает': lacks(/(я уверен|точно знаю|это точно|несомненно|безусловно|вне сомнений)/i),
    },
  },
  {
    id: '21.3',
    title: 'приложенный текст написан ИИ, вопрос на следующем ходу',
    // Оговорка звучала в прошлом ходе, вопрос этого хода нейтральный: в product
    // строка К21-5 остаётся в блоке заметки и на этом ходу, а без неё модели
    // остаётся помнить реплику двухходовой давности.
    documentContent: { base: block(false), fix: block(true) },
    noteScope: { mode: 'note', title: AI_SUMMARY_TITLE, date: '2026-10-20' },
    messages: [
      { role: 'user', content: 'Этот текст написала нейросеть. Посмотри его.' },
      { role: 'assistant', content: 'Понял, смотрю на него как на текст, а не как на твои слова.' },
      { role: 'user', content: 'А что там про чужие задачи?' },
    ],
    responseLength: 'standard',
    lowerIsBetter: ['формулировки поданы как слова человека', 'автор текста — человек, а не ИИ'],
    checks: {
      // Замер тикета: доля ответов, где формулировки такого текста поданы как
      // слова человека. Глаголы авторства и речи (в том числе «человек пишет»,
      // «в твоих словах») — без «ты решил/хочешь»: о жизни человека модель
      // говорит и в правильном ответе.
      // Признак в две ступени: обращение к человеку как к автору текста
      // («ты пишешь, что…») и мягкая третьеличная форма («человек пишет…» —
      // автор всё равно человек, а не нейросеть). «Ты сказал, что это
      // нейросеть» — реплика диалога, а не авторство, и в признак не идёт.
      'формулировки поданы как слова человека': has(/ты (писал|написал|пишешь|отметил|отмечал|упоминал|рассказывал|замечал|описал|жалуешься|признался)|ты сам (описывал|написал|сформулировал)|в твоих словах|твои слова/i),
      'автор текста — человек, а не ИИ': has(/человек (пишет|говорит|отмечает|рассказывает)/i),
      'оговорка учтена': has(/(нейросет|текст написан (ии|нейросет|не тобой)|(ии|нейросет|чат)[^.]{0,30}(написал|составил|сгенерировал)|чуж(ой|ие|ую) формулировк|не твои (слова|формулировк)|сгенерирован)/i),
      // Побочный провал плеча «до»: вместо разбора — отказ («разбирать как чью-то
      // личную ситуацию не буду»).
      'разбирает, а не отказывается': lacks(/не буду (это )?(разбирать|разбор)|разбирать[^.]{0,40}не буду|подмен[аы]/i),
    },
  },
];

const args = process.argv.slice(2);
const arg = (name: string, def?: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const RUNS = Number(arg('--runs', '8'));
const ONLY = arg('--only')?.split(',');
const PERSONAS = (arg('--personas', 'group_psychology,cbt,coach') ?? '').split(',');
const OUT = arg('--out', '/tmp/case21-bench.json')!;
const MODEL = process.env.CASE21_MODEL ?? DEFAULT_AI_CHAT_MODEL;
const KEY = process.env.OPENROUTER_API_KEY;
const BASE = process.env.CASE21_BASE_URL ?? 'https://openrouter.ai/api/v1';
const RESCORE = arg('--rescore');
if (!KEY && !RESCORE) throw new Error('нужен OPENROUTER_API_KEY');

async function ask(system: string, messages: Msg[]): Promise<{ text: string; cost: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: system }, ...messages], reasoning: { effort: 'none' }, max_tokens: 4096, usage: { include: true } }),
      });
      if (res.ok) {
        // Провайдер иногда отвечает 200 с пустым телом: это повтор, а не провал замера.
        const d = await res.json() as { choices?: { message?: { content?: string } }[]; usage?: { cost?: number } };
        const text = d.choices?.[0]?.message?.content ?? '';
        if (text) return { text, cost: d.usage?.cost ?? 0 };
      }
    } catch {
      // Сетевой сбой или не-JSON — тоже повтор.
    }
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error('провайдер не ответил трижды');
}

const results: Array<{ scenario: string; arm: Arm; persona: string; run: number; answer: string; checks: Record<string, boolean> }> = [];
let cost = 0;

if (RESCORE) {
  const saved = JSON.parse(readFileSync(RESCORE, 'utf8')) as { results: typeof results };
  for (const r of saved.results) {
    const sc = SCENARIOS.find(x => x.id === r.scenario);
    if (!sc || (ONLY && !ONLY.includes(sc.id))) continue;
    results.push({ ...r, checks: Object.fromEntries(Object.entries(sc.checks).map(([k, f]) => [k, f(r.answer)])) });
  }
}

for (const sc of RESCORE ? [] : SCENARIOS.filter(s => !ONLY || ONLY.includes(s.id))) {
  for (const arm of ['base', 'fix'] as Arm[]) {
    for (const personaId of PERSONAS) {
      const documentContent = sc.documentContent[arm];
      const system = buildChatSystemPrompt(assembleChatPromptParams({
        personaId,
        messages: sc.messages,
        documentContent,
        responseLength: sc.responseLength,
        reasoning: false,
        authorGender: 'm',
        noteScope: sc.noteScope,
      }));
      let prompt = system;
      if (sc.stripFromSystem && arm === 'base') {
        prompt = system.replace(sc.stripFromSystem, '');
        if (prompt === system) throw new Error(`${sc.id}: правка не вырезана — плечо «до» совпало бы с «после»`);
      }
      if (sc.id === '21.3' && arm === 'fix' && !prompt.includes(AI_WRITTEN_LINE)) {
        throw new Error(`${sc.id}: в плече «после» нет строки ${JSON.stringify(AI_WRITTEN_LINE.slice(0, 20))}`);
      }
      const jobs = Array.from({ length: RUNS }, (_, run) => ask(prompt, sc.messages).then(r => ({ run, ...r })));
      for (const { run, text, cost: c } of await Promise.all(jobs)) {
        cost += c;
        results.push({ scenario: sc.id, arm, persona: personaId, run, answer: text, checks: Object.fromEntries(Object.entries(sc.checks).map(([k, f]) => [k, f(text)])) });
      }
      // Писать после каждой пачки: обрыв провайдера не должен уносить готовое.
      writeFileSync(OUT, JSON.stringify({ model: MODEL, runs: RUNS, results }, null, 2));
    }
  }
}

writeFileSync(OUT, JSON.stringify({ model: MODEL, runs: RUNS, results }, null, 2));

const rate = (rows: typeof results, name: string) => {
  const hit = rows.filter(r => r.checks[name]).length;
  return `${hit}/${rows.length}`;
};
// Проверка-метрика (lowerIsBetter): хорошо, когда не сработала.
const good = (sc: Scenario, r: { checks: Record<string, boolean> }) =>
  Object.entries(r.checks).every(([k, v]) => (sc.lowerIsBetter?.includes(k) ? !v : v));
for (const sc of SCENARIOS.filter(s => !ONLY || ONLY.includes(s.id))) {
  console.log(`\n${sc.id} — ${sc.title}`);
  for (const name of Object.keys(sc.checks)) {
    const base = rate(results.filter(r => r.scenario === sc.id && r.arm === 'base'), name);
    const fix = rate(results.filter(r => r.scenario === sc.id && r.arm === 'fix'), name);
    console.log(`  ${name}${sc.lowerIsBetter?.includes(name) ? ' (сработало — хуже)' : ''}: до ${base} → после ${fix}`);
  }
  for (const arm of ['base', 'fix'] as Arm[]) {
    for (const p of PERSONAS) {
      const rows = results.filter(r => r.scenario === sc.id && r.arm === arm && r.persona === p);
      console.log(`  · ${arm} ${p}: ответ без провалов ${rows.filter(r => good(sc, r)).length}/${rows.length}`);
    }
  }
}
console.log(`\nмодель ${MODEL}, стоимость ≈ $${cost.toFixed(4)}, ответы: ${OUT}`);
