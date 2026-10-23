#!/usr/bin/env node
// PX-4 · стенд замерa «связанных дней»: ближайший чанк против центроида.
//
// Кейс 9.5: дневниковая заметка, выросшая из разговора three days earlier, не
// получила этот разговор в «Другие дни». Гипотеза: расшифровка сеанса ~33k знаков
// на десятки тем, её центроид размыт и проигрывает коротким записям, хотя один
// чанк — ровно про тему заметки.
//
// Варианты оценки похожести (для пары «приложенная заметка → другая заметка»):
//   a — центроид против центроида (как сегодня в relatedDays.ts)
//   b — максимум по всем парам чанков
//   c — центроид приложенной против лучшего чанка другой
//   d — среднее top-2 пар (для каждого чанка приложенной — её лучший чанк другой)
//
// Данные СИНТЕТИЧЕСКИЕ: выдуманная авторка стенда (Вера, скрипачка) и её
// выдуманные люди. Ни строки из живого архива. Векторы — прод-моделью
// `qwen/qwen3-embedding-8b` через OpenRouter; окно чанков то же, что в
// api/ai/embedDocument.logic.ts (1000 знаков, перекрытие 150, потолок 200).
//
// Запуск:
//   OPENROUTER_API_KEY="$(cat ~/.config/jw-audit/openrouter_key)" \
//     npx tsx scripts/ai-bench/related-days-chunk-bench.mjs
//   npx tsx scripts/ai-bench/related-days-chunk-bench.mjs --selftest   # математика без сети
// Режимы: --selftest (математика без сети) | --sizes (размеры корпуса и число окон)
// Кэш векторов: scripts/ai-bench/.cache/related-days-vectors.json (не в git).
// Запускать через npx tsx — стенд импортирует .ts из дерева, как run.mjs.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2)
  .map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]] : [])
  .filter(Boolean));
const BASE_URL = process.env.OPENROUTER_BASE ?? 'https://openrouter.ai/api/v1';
const EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL ?? 'qwen/qwen3-embedding-8b';
// В имени кэша — отпечаток корпуса: иначе после правки текстов замер молча
// посчитался бы на старых векторах.
function fingerprint(list) {
  let h = 2166136261;
  for (const n of list) {
    const t = n.id + ':' + n.body.length + ':' + n.kind;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  }
  return (h >>> 0).toString(16);
}


// ── чанковка ─────────────────────────────────────────────────────────────────
// Окна берутся ИЗ ДЕРЕВА (api/ai/embedDocument.logic.ts), а не переписываются
// сюда. 13.10 на этой копии поймали ложную находку: в перенесённой вручную
// функции потерялась строка `if (end >= text.length) break;`, и стенд начал
// приписывать проду ~148 дегенеративных чанков на длинной заметке, которых в
// проде нет. Отсюда вывод: мерить можно только прод-функцией.
import { chunkText } from '../../api/ai/embedDocument.logic.ts';

// ── метрика ──────────────────────────────────────────────────────────────────
export function cosine(u, v) {
  let d = 0, a = 0, b = 0;
  const n = Math.min(u.length, v.length);
  for (let i = 0; i < n; i++) { d += u[i] * v[i]; a += u[i] * u[i]; b += v[i] * v[i]; }
  return a && b ? d / Math.sqrt(a * b) : 0;
}

export function centroid(vectors) {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) sum[i] += v[i];
  return sum.map(x => x / vectors.length);
}

/** Оценка похожести пары заметок; варианты a/b/c/d — см. шапку файла. */
export function scorePair(variant, selfVecs, otherVecs) {
  const A = centroid(selfVecs), B = centroid(otherVecs);
  if (!A || !B) return 0;
  if (variant === 'a') return cosine(A, B);
  if (variant === 'c') {
    let best = -1;
    for (const bv of otherVecs) best = Math.max(best, cosine(A, bv));
    return best;
  }
  if (variant === 'b') {
    let best = -1;
    for (const av of selfVecs) for (const bv of otherVecs) best = Math.max(best, cosine(av, bv));
    return best;
  }
  if (variant === 'd') {
    const tops = selfVecs.map(av => {
      let best = -1;
      for (const bv of otherVecs) best = Math.max(best, cosine(av, bv));
      return best;
    }).sort((x, y) => y - x).slice(0, 2);
    return tops.reduce((s, x) => s + x, 0) / tops.length;
  }
  throw new Error(`неизвестный вариант ${variant}`);
}

const VARIANTS = ['a', 'b', 'c', 'd'];

// ── синтетический корпус ─────────────────────────────────────────────────────
// Всё выдуманное: авторка стенда (Вера, скрипачка) и её выдуманные люди. Ни
// строки из живого архива. Тексты собраны из нескольких речевых пулов, чтобы
// похожие по теме записи не совпадали дословно, — иначе мера проверяет шаблон,
// а не геометрию эмбеддинга.
//
// X — то, о чём заметка: декабрьское соло и неумение сказать дирижёру «нет».
// В нужной расшифровке сеанса под X ушёл один кусок среди двенадцати тем
// (≈5 % текста), остальное — другие темы. Именно это, по гипотезе 9.5, размывает
// центроид длинной записи.
const X_SEGMENT = 'Ольга Петровна спрашивает про декабрь: «Ты согласилась на соло или нет?» Вера говорит, что сказала «подумаю» и с тех пор не может ответить. Дальше разворачивается главное: она не умеет сказать дирижёру «нет», потому что тогда он решит, что она непопулярная, а ей важно быть нужной оркестру. Ольга Петровна просит назвать, чего она боится после отказа. Вера отвечает: «Что меня перестанут звать». Обсуждают, что «подумаю» — уже ответ, и что отсрочка не спасает от решения. Вера приводит пример с Леной: три недели не отвечала про крышу в родительской квартире, а потом ответила за двадцать минут. Ольге Петровне это кажется тем же самым механизмом. Предлагают правило до четверга: ни одного «да» в тот же день. Вера соглашается и тут же торгуется — просит оставить «да» ученикам. Разбирают тело: перед репликой дирижёру перехватывает дыхание; пробуют проговорить отказ вслух, стоя у окна. Вера смеётся: смешно отказывать человеку, который принёс чай. Договорились: до четверга соло не брать, а дирижёру сказать ровно одну заготовленную фразу.';

const STEMS = [
  'Речь зашла про', 'Самое трудное в', 'Вспоминаю', 'Обсудили', 'Получается, в',
  'Отдельно поговорили про', 'Дальше разобрали', 'Сюда же примешивается',
];
const TAILS = [
  'и я снова беру это на себя, а злюсь потом',
  'и проще всего назвать срок, а не обещать',
  'и тогда помогает одна короткая фраза, сказанная заранее',
  'и я молчу три дня, а потом пишу длинное письмо',
  'и выходит, что я тяну не потому, что не хочу, а потому, что боюсь ответа',
  'и это заметно по тому, как я собираюсь перед выходом',
  'и хорошо бы проверить это на одном маленьком случае',
  'и я записываю, что было на самом деле, а не как хотелось бы',
  'и главное там — не спорить с собой, а называть вслух',
  'и потом выясняется, что разговор занял двадцать минут',
];
const FILLERS = ['Вера', 'Ольга Петровна', 'Глеб', 'Лена', 'Марат', 'завуч', 'мама Сони', 'дирижёр', 'Соня', 'соседка'];
const CLAUSES = [
  'и на этом разговор не кончается',
  'и дальше всё равно решаю сама',
  'и это легко перепутать с упрямством',
  'и утром выглядит иначе',
  'и со стороны это незаметно',
  'и я называю это вслух',
  'и потом проверяю по записи',
  'и здесь я снова молчу',
  'и это стоит мне вечера',
  'и через неделю смешно вспомнить',
  'и я не жду подсказки',
  'и на полуслове не бросаю',
];

function paragraph(topic, seed) {
  const lines = [];
  for (let k = 0; k < 20; k++) {
    const speaker = FILLERS[(k * 3 + topic.length + seed) % FILLERS.length];
    const stem = STEMS[(k + seed) % STEMS.length];
    const tail = TAILS[(k * 7 + seed * 3) % TAILS.length];
    const clause = CLAUSES[(k * 5 + seed) % CLAUSES.length];
    lines.push(speaker + ': ' + stem.toLowerCase() + ' ' + topic + ' ' + tail + ', ' + clause + '.');
  }
  return lines.join(' ');
}

const TOPIC_SETS = {
  session: [
    'прокатная скрипка Сони и размер инструмента',
    'отчёт для завуча к пятнице',
    'переписка с Леной о крыше',
    'подмены Марата в расписании',
    'вторые скрипки в оркестре',
    'урок в восемь утра',
    'соло в декабре и отказ дирижёру',
    'день рождения тёти в субботу',
    'запасной смычок после перетяжки',
    'собрание педагогов',
    'мама Сони и просьба надавить',
    'настройка струны ля',
  ],
  sessionAlt: [
    'концерт младших и перенос на май',
    'отчёт по посещаемости',
    'ремонт в музыкальной школе',
    'разговор с завучем о нагрузке',
    'покупка диктофона для уроков',
    'репетиция гамм перед контрольным',
    'проезд на репетиции и расписание электричек',
    'врач и ноющее колено',
    'страховка на машину Глеба',
    'старый пюпитр из фанеры',
  ],
  decoyA: [
    'счёт за электричество и показания',
    'стиральная машина и мастер из ЖЭКа',
    'покупка зимних ботинок',
    'репетитор по математике для соседского сына',
    'аптека и витамины на весну',
    'дорога к тёте и билет на автобус',
    'ремонт подъездной двери',
  ],
  decoyB: [
    'разбор чужого концерта в филармонии',
    'методичка для начинающих скрипачей',
    'список нот на лето',
    'аренда зала под репетиции',
    'комплект струн и колешки',
    'настройка рояля перед экзаменом',
  ],
  decoyC: [
    'разговор с соседом про шум по вечерам',
    'поход к врачу и запись на МРТ',
    'подписка на музыкальный сервис',
    'дача и теплица под плёнкой',
    'чтение книги про тренерство',
  ],
};

function transcript(topics, xTopic) {
  const parts = [];
  topics.forEach((topic, i) => {
    parts.push('Тема ' + (i + 1) + ' — ' + topic + '. ' + paragraph(topic, i));
    if (xTopic && topic === xTopic) parts.push(X_SEGMENT);
  });
  return parts.join('\n\n');
}

// Короткие записи: часть про то же, что и заметка-запрос, но из других дней
// (те же поверхностные слова — соло, дирижёр, «подумаю»), и часть из другой
// жизни. Правильная расшифровка должна выигрывать у тех и у других.
const NEAR_X = [
  'Соня принесла этюд и снова сбивается на втором такте. Обещаю себе не говорить «ещё раз» автоматически.',
  'Дирижёр задержался после репетиции и похвалил за тихий вход во второй части. Иду домой и не понимаю, почему это важнее самой игры.',
  'Марат просит подмену на субботу, я говорю «посмотрю». Отсрочка привычнее отказа.',
  'Завуч просит программу к пятнице. Пишу две строки и стираю: кажется, что оправдываюсь.',
  'Лена снова про крышу. Отвечаю через три дня и злюсь на себя, а не на неё.',
  'Мама Сони спрашивает, почему ребёнку скучно. Отвечаю про темп, а не про то, что мне самое трудное.',
  'После концерта дирижёр предложил сыграть вальс, я снова сказала «давайте подумаю» и весь вечер прокручивала.',
];
const SHORT_OTHER = [
  'Купила струны ля, настроила вечером — держат.',
  'Автобус опоздал, проехала одну остановку пешком и пришла в школу разогретой.',
  'Сосед свернул музыку, и вечером стало слышно метроном у этажом выше.',
  'Тёте купила шарф, а поздравить всё не могу.',
  'Врач сказал, что колено — от стула, а не от сцены.',
  'Диктофон записывает гул холодильника; на уроках это мешает.',
  'Глеб помыл посуду и не напомнил, что помыл.',
  'Мама Сони заплакала в коридоре, но не про Соню.',
  'Рояль в малом зале расстроен, и все играют тише.',
  'Счёт за свет пришёл с переплатой, позвонила и разобрались.',
  'На планёрке говорила без бумажки и забыла половину.',
  'Зимние ботинки жмут, а менять лениво.',
  'В мае концерт младших, в декабре — старших.',
  'Метроном отца: тишина в квартире была условием, чтобы сыгралось.',
  'Прочитала главу про тренерство и уснула на странице.',
];

// Запросы: заметки, выросшие из сеанса. Два коротких и два длинных (диктовка),
// чтобы варианты b, c и d не схлопывались в один: у одночанковой заметки они
// совпадают по построению.
const Q3_EXTRA = [
  'Утром перечитала список того, что обещала завучу, и увидела, что половина пунктов написаны в сослагательном наклонении.',
  'На уроке у Сони снова поехал темп, и я поймала себя на том, что смягчаю голос, чтобы не показаться строгой.',
  'Глеб спрашивал, устала ли я, и я ответила, что нет, хотя день был из тех, где не помнишь, что ела.',
  'В оркестре во вторник обсуждали программу, и я сидела так, чтобы не смотрели на меня.',
  'Мне стыдно за то, что я слежу за реакцией дирижёра даже тогда, когда играю хорошо.',
  'Завуч просит программу к ноябрю, и я опять пишу объяснительную вместо списка.',
  'Лена прислала фото крыши без вопроса, и я не знаю, отвечать сразу или ждать повода.',
  'Мама звонила про день рождения тёти и упомянула, что я «всегда так» — вот это «всегда» меня задело.',
  'После диктовки провала на планёрке я дышала четыре раза, и голос перестал пищать.',
  'Мне важно, чтобы меня позвали снова, и из-за этого я соглашаюсь раньше, чем думаю.',
  'Соня спросила, наказываю ли я её медленными темпами, и я не нашлась, что ответить.',
  'Купила струны и подумала, что хоть в инструменте можно что-то настроить самому.',
  'Марат принёс чай и извинился за подмену, а я не смогла сказать, что мне это в тягость.',
  'Вечером репетировала переход к репризе и услышала, что играю напряжённо даже в паузе.',
  'Записала в календаре: в понедельник до первого урока сказать дирижёру одну фразу.',
  'Если после этого меня не позовут на декабрь, значит, звали только потому, что я не отказывалась.',
  'Потренировала фразу на диктофоне, и она звучит грубее, чем я её придумала.',
  'Ольга Петровна сказала, что отсрочка не спасает от решения, и с этим не спорится.',
];
const Q4_EXTRA = [
  'Дорога на репетицию заняла час, и я весь час прокручивала один и тот же диалог с начала.',
  'В прошлый четверг я уже решила, что откажусь, но взяла ноты и промолчала.',
  'Мне удобно, когда отказ звучит как забота: «давайте я подхожу позже».',
  'Дирижёр не давит, и от этого особенно трудно сказать «нет».',
  'Я заметила, что отказ дается легче, если он короткий и без причин.',
  'Если я скажу правду про нагрузку, придётся признать, что беру лишнее сама.',
  'Лена в субботу сказала, что я отвечаю через три дня на всё, и была права.',
  'На уроке я попросила Соню играть тише, и она спросила, не злюсь ли я.',
  'Завуч похвалила отчёт, и я растерялась: он был написан как оправдание.',
  'Мне нравится, когда меня слушают дословно, и раздражает, когда сразу обобщают.',
  'Тётя передавала привет и напомнила про субботу, и я опять ничего не ответила.',
  'Врач сказал беречь колено, и я подумала, что беречь — это тоже отказ.',
  'После сеанса я трижды перечитала запись про «подумаю» и всё равно не поняла, что решать.',
  'Заготовила фразу: «В декабре я не потяну соло, давайте вернёмся к этому в январе».',
  'Если её не сказать, я буду весь ноябрь думать, что я трусиха, и это уже было.',
  'Соседка спрашивала, почему у нас по вечерам метроном, и я ответила, что это привычка отца.',
  'Марат уйдёт в отпуск в ноябре, и подмены лягут на меня, и я, конечно, соглашусь.',
  'Хочу, чтобы в разговоре со мной сначала называли то, что видно, а потом уже причины.',
  'Услышала в записи свой голос и не узнала: говорила быстро и выше, чем на уроках.',
  'Отказывать неприятно, но молчать три недели неприятнее, и я это уже проходила.',
];
const Q3_PARTS = [
  'Правило до четверга не работает, потому что я торгуюсь: ученикам говорю «да» сразу, а дирижёру не говорю ничего.',
  'Значит, и с декабрьским соло надо ответить, а не тянуть.',
  'Ольга Петровна сказала, что «подумаю» — это уже ответ, и я услышала это впервые за неделю.',
  'Дома проговорила отказ вслух у окна: смешно отказывать человеку, который принёс чай, и всё равно руки перехватывает.',
  'Лена три недели молчала про крышу, а потом разговор занял двадцать минут, и я подумала, что это про меня же.',
  'Надо выбрать одну фразу и сказать её в понедельник, а не решать в голове каждый раз заново.',
  'Боюсь, что после отказа меня перестанут звать во вторые скрипки, и вторник станет обычным днём.',
  'Если я не возьму соло, никто не умрёт, но я сама себя запишу в тех, кому нельзя доверять.',
  'Мама Сони сегодня спрашивала про темп, и я снова ушла в объяснения вместо одного слова.',
  'Попробую завтра начать с короткого «нет» на маленьком случае — подмена Марату — и посмотреть, что будет.',
];
const Q4_PARTS = [
  'Соло в декабре висит без ответа с четверга.',
  'Ольга Петровна спросила прямо: чего ты боишься после отказа. Я ответила не сразу: что меня перестанут звать.',
  'Это же, только крупнее, про Лёнину крышу и про мамину субботу.',
  'Мы взяли правило: до четверга ни одного «да» в тот же день.',
  'Я тут же начала торговаться и попросила оставить «да» ученикам, и она это заметила.',
  'Тело помнит раньше головы: перед репликой дирижёру перехватывает дыхание, а голос поднимается.',
  'Проговорили отказ вслух у окна три раза, и на третьем стало смешно — неудобно отказывать человеку, который принёс чай.',
  'Осталась одна заготовленная фраза на понедельник, и я боюсь не дирижёра, а того, что после неё вторник станет обычным днём.',
  'Если скажу «нет», программа не рухнет; рушится что-то во мне, и это надо назвать, а не прятать за «подумаю».',
  'Ещё про отчёт завучу: я пишу его как оправдание, и это тот же жанр, что и мой ответ дирижёру.',
  'Значит, начинаю с маленького: подмена Марату и одна фраза дирижёру, а соло решаю после, а не в голове.',
];

// Ещё короткие записи: конкуренция за четыре места в фоне. Половина — про те же
// поверхностные слова (соло, дирижёр, отказ, вторник), половина — из другой жизни. Без
// них правильный сеанс выигрывает top-4 в любом варианте, и мера ничего не
// проверяет.
const SURFACE = ['соло', 'дирижёр', 'отказ', 'вторник в оркестре', '«подумаю»', 'репетиция', 'вторая партия', 'декабрь'];
const SITUATIONS = [
  'записала в календарь и отложила',
  'назвала вслух и пожалела',
  'прорепетировала дважды и всё равно тяну',
  'сказала, что подхожу позже',
  'обещала ответить до четверга',
  'прокрутила вечер и не решила',
  'попросила времени и ушла',
  'согласилась до того, как подумала',
];
const CONTEXTS = [
  'на уроке у Сони', 'на планёрке у завуча', 'после репетиции', 'в разговоре с Леной',
  'на созвоне с Маратом', 'в переписке с мамой', 'в автобусе после вторника', 'перед контрольным',
  'на собрании педагогов', 'в мастерской со смычком', 'на концерте младших', 'в очереди в аптеку',
  'за отчётом в четверг', 'на прогулке с Глебом', 'во время настройки', 'у окна перед сном',
  'в коридоре школы', 'после диктовки', 'на фоне холодильного гула', 'в электричке',
  'у тёти на дне рождения', 'на встрече с родительским комитетом', 'после разбора записи', 'в фойе филармонии',
  'на замене в нулевой группе', 'в разговоре с завхозом', 'перед прослушиванием', 'на сборе нот',
  'в очередном отчёте', 'после разговора с директором', 'в заметке о ремонтах', 'при проезде через мост',
];
// Заметки, где поверхность та же, а содержания нет (главный конкурент сеанса).
const NEAR_NOTES = [];
for (let i = 0; i < 14; i++) {
  const word = SURFACE[i % SURFACE.length];
  const ctx = CONTEXTS[(i * 3) % CONTEXTS.length];
  const sit = SITUATIONS[(i * 5) % SITUATIONS.length];
  NEAR_NOTES.push(`${ctx.charAt(0).toUpperCase() + ctx.slice(1)} — снова ${word}: ${sit}.Деталей не помню, помню только, что отвечала не сразу.`);
}
// Заметки совсем из другой жизни.
const FAR_NOTES = [];
for (let i = 0; i < 16; i++) {
  const ctx = CONTEXTS[(i * 7 + 3) % CONTEXTS.length];
  const sit = SITUATIONS[(i * 3 + 1) % SITUATIONS.length];
  const topic = ['оплата за свет', 'замена ботинок', 'лист ожидания в поликлинике', 'теплица', 'проездной', 'страховка', 'пылесос', 'книга про сон', 'ремонт двери', 'заказ струн', 'абонемент в бассейн', 'запись на диктофон', 'покупка пюпитра', 'перевод часов', 'соседский ремонт', 'рецепт настойки'][i];
  FAR_NOTES.push(`${ctx.charAt(0).toUpperCase() + ctx.slice(1)} про ${topic}: ${sit}.`);
}

const QUERIES = [
  { id: 'q1', kind: 'query', body: 'После разговора с Ольгой Петровной осталось: «подумаю» — это уже ответ. Дирижёру в понедельник надо сказать ровно одну фразу, и я её записала, чтобы не сочинять на ходу.' },
  { id: 'q2', kind: 'query', body: 'Три дня назад на сеансе назвали то, чего я боюсь после отказа, — что перестанут звать. Сегодня дирижёр снова про декабрь, и я узнала тот самый страх.' },
  { id: 'q2b', kind: 'query', body: 'Записываю вечером, чтобы не забыть формулировку: я не отказываюсь от соло, я тяну с ответом, потому что боюсь, что после «нет» меня перестанут звать во вторые скрипки. Ольга Петровна назвала это тем же механизмом, что и молчание с Леной про крышу.' },
  { id: 'q2c', kind: 'query', body: 'Одна фраза дирижёру в понедельник — и не объяснять её ничем. Правило до четверга пошло вкривь, потому что ученикам я говорю «да» сразу.' },
  { id: 'q3', kind: 'query', body: 'Диктую, пока помню.\n\n' + [...Q3_PARTS, ...Q3_EXTRA].join(' ') },
  { id: 'q4', kind: 'query', body: 'Запись после сеанса, диктовка в машине.\n\n' + [...Q4_PARTS, ...Q4_EXTRA].join(' ') },
];

const CORPUS = [
  { id: 'sessionA', kind: 'positive_long', body: transcript(TOPIC_SETS.session, 'соло в декабре и отказ дирижёру') },
  { id: 'sessionB', kind: 'related_long', body: transcript(TOPIC_SETS.sessionAlt, null) },
  { id: 'decoy1', kind: 'decoy_long', body: transcript(TOPIC_SETS.decoyA, null) },
  { id: 'decoy2', kind: 'decoy_long', body: transcript(TOPIC_SETS.decoyB, null) },
  { id: 'decoy3', kind: 'decoy_long', body: transcript(TOPIC_SETS.decoyC, null) },
  ...NEAR_X.map((body, i) => ({ id: 'near' + (i + 1), kind: 'short_same_topic', body })),
  ...SHORT_OTHER.map((body, i) => ({ id: 'o' + (i + 1), kind: 'short_other', body })),
  ...NEAR_NOTES.map((body, i) => ({ id: 'nearB' + (i + 1), kind: 'short_same_topic', body })),
  ...FAR_NOTES.map((body, i) => ({ id: 'far' + (i + 1), kind: 'short_other', body })),
];

// ── векторы ──────────────────────────────────────────────────────────────────
async function embed(texts) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('нужен OPENROUTER_API_KEY (или --selftest)');
  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    signal: AbortSignal.timeout(180_000),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`embeddings ${res.status}: ${txt.slice(0, 200)}`);
  const j = JSON.parse(txt);
  return { vectors: j.data.map(d => d.embedding), usage: j.usage };
}

async function vectorsFor(note) {
  const chunks = chunkText(note.body);
  const out = [];
  let cost = 0, tokens = 0;
  for (let i = 0; i < chunks.length; i += 16) {
    const r = await embed(chunks.slice(i, i + 16));
    out.push(...r.vectors);
    tokens += r.usage?.total_tokens ?? 0;
    cost += r.usage?.cost ?? 0;
  }
  return { id: note.id, kind: note.kind, chunks, vectors: out, tokens, cost };
}

// ── анализ ───────────────────────────────────────────────────────────────────
const pct = (arr, p) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))].toFixed(3);
};

function analyse(perNote) {
  const by = Object.fromEntries(perNote.map(n => [n.id, n]));
  const rows = [];
  for (const q of QUERIES) {
    const self = by[q.id];
    for (const cand of CORPUS) {
      if (cand.id === q.id) continue;
      const other = by[cand.id];
      for (const v of VARIANTS) {
        rows.push({ query: q.id, cand: cand.id, kind: cand.kind, variant: v, score: scorePair(v, self.vectors, other.vectors), chunks: other.chunks.length });
      }
    }
  }
  const g = (v, ...kinds) => rows.filter(r => r.variant === v && kinds.includes(r.kind)).map(r => r.score);
  const report = [];

  report.push('## Распределение похожести (медиана / p90 / максимум)');
  report.push('| вариант | сеанс с сегментом X (правильный) | короткие заметки про X | другой длинный сеанс | decoy-расшифровки | короткие не про X |');
  report.push('|---|---|---|---|---|---|');
  for (const v of VARIANTS) {
    const cell = arr => `${pct(arr, 0.5)} / ${pct(arr, 0.9)} / ${pct(arr, 1)}`;
    report.push(`| ${v} | ${cell(g(v, 'positive_long'))} | ${cell(g(v, 'short_same_topic'))} | ${cell(g(v, 'related_long'))} | ${cell(g(v, 'decoy_long'))} | ${cell(g(v, 'short_other'))} |`);
  }
  report.push('');
  report.push('Разрыв «правильный сеанс против всех случайных» (медиана случайных → минимум правильного):');
  for (const v of VARIANTS) {
    const pos = g(v, 'positive_long'), rnd = [...g(v, 'decoy_long'), ...g(v, 'short_other'), ...g(v, 'related_long')];
    const overlap = rnd.filter(x => x >= Math.min(...pos)).length;
    report.push(`- ${v}: min правильного ${Math.min(...pos).toFixed(3)}, медиана случайных ${pct(rnd, 0.5)}, p90 ${pct(rnd, 0.9)}, случайных пар выше минимума правильного: ${overlap}/${rnd.length}`);
  }

  report.push('\n## Ранжирование: попадает ли правильный сеанс в top-4 (без порога)');
  report.push('| вариант | recalltop4 | median-позиция правильного | decoy в top-4 | короткие не про X в top-4 |');
  report.push('|---|---|---|---|---|');
  const rankStats = {};
  for (const v of VARIANTS) {
    let hit = 0, decoy = 0, other = 0, positions = [];
    for (const q of QUERIES) {
      const list = rows.filter(r => r.variant === v && r.query === q.id).sort((a, b) => b.score - a.score);
      const pos = list.findIndex(r => r.cand === 'sessionA') + 1;
      positions.push(pos);
      if (pos <= 4) hit++;
      if (list.slice(0, 4).some(r => r.kind === 'decoy_long')) decoy++;
      if (list.slice(0, 4).some(r => r.kind === 'short_other')) other++;
    }
    rankStats[v] = { hit, decoy, other, n: QUERIES.length, pos: positions.join(',') };
    report.push(`| ${v} | ${hit}/${QUERIES.length} (${Math.round(100 * hit / QUERIES.length)} %) | ${positions.join(', ')} | ${decoy}/${QUERIES.length} | ${other}/${QUERIES.length} |`);
  }

  report.push('\n## Порог: случайные пары выше него не поднимаются');
  report.push('| вариант | порог | ложные случайные пары | правильный сеанс выше порога | вложенные в top-4 по этому порогу |');
  report.push('|---|---|---|---|---|');
  const threshStats = {};
  for (const v of VARIANTS) {
    let chosen = null;
    for (let th = 0.30; th <= 0.95; th += 0.005) {
      const t = Number(th.toFixed(3));
      const rnd = [...g(v, 'decoy_long'), ...g(v, 'short_other')];
      const fp = rnd.filter(x => x >= t).length;
      if (fp / rnd.length <= 0.01) { chosen = { th: t, fp, total: rnd.length }; break; }
    }
    if (!chosen) { report.push(`| ${v} | порога под 1 % нет | — | — | — |`); continue; }
    const pos = g(v, 'positive_long');
    const above = pos.filter(x => x >= chosen.th).length;
    let picked = 0;
    for (const q of QUERIES) {
      const list = rows.filter(r => r.variant === v && r.query === q.id && r.score >= chosen.th).sort((a, b) => b.score - a.score).slice(0, 4);
      if (list.some(r => r.cand === 'sessionA')) picked++;
    }
    threshStats[v] = { ...chosen, above, posTotal: pos.length, picked };
    report.push(`| ${v} | ${chosen.th.toFixed(3)} | ${chosen.fp}/${chosen.total} (${(100 * chosen.fp / chosen.total).toFixed(1)} %) | ${above}/${pos.length} | ${picked}/${QUERIES.length} |`);
  }

  report.push('\n## Смещение в сторону длинных записей (при ранжировании по порогу)');
  report.push('| вариант | средний размер чанков у попавших в top-4 | доля длинных (>15 чанков) |');
  report.push('|---|---|---|');
  for (const v of VARIANTS) {
    const st = threshStats[v];
    if (!st) continue;
    const sizes = [];
    for (const q of QUERIES) {
      const list = rows.filter(r => r.variant === v && r.query === q.id && r.score >= st.th).sort((a, b) => b.score - a.score).slice(0, 4);
      sizes.push(...list.map(r => r.chunks));
    }
    const longs = sizes.filter(x => x > 15).length;
    report.push(`| ${v} | ${(sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length)).toFixed(1)} | ${longs}/${sizes.length} |`);
  }

  if (args.detail) {
    report.push('\n## Детально: top-4 каждого запроса (id и оценка)');
    for (const v of VARIANTS) {
      report.push(`\nвариант ${v}:`);
      for (const q of QUERIES) {
        const list = rows.filter(r => r.variant === v && r.query === q.id).sort((a, b) => b.score - a.score).slice(0, 5);
        report.push(`  ${q.id}: ${list.map(r => `${r.cand} (${r.kind.charAt(0)}) ${r.score.toFixed(3)}`).join(' | ')}`);
      }
    }
  }

  report.push('\n## Кандидат на победителя');
  const best = VARIANTS.map(v => ({ v, ...rankStats[v], ...threshStats[v] })).sort((a, b) => (b.hit - a.hit) || (a.decoy - b.decoy));
  report.push(`по recall в top-4: ${best.map(x => `${x.v}=${x.hit}/${x.n}`).join(', ')}; по ложным парам при своём пороге: ${VARIANTS.map(v => `${v}=${threshStats[v] ? `${threshStats[v].fp}/${threshStats[v].total}` : '—'}`).join(', ')}`);
  return report.join('\n');
}

// ── selftest: математика на синтетических векторах, без сети ─────────────────
function selftest() {
  const v = a => a;
  const topicX = v([1, 1, 0, 0, 0, 0, 0, 0]);
  const noise = [[0, 0, 1, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 1, 0, 0], [0, 0, 0, 0, 0, 0, 1, 1], [0.1, 0.1, 0.2, 0.2, 0.1, 0.1, 0.2, 0.2]];
  const longNote = [topicX, ...noise];
  const shortNote = [v([0.8, 0.8, 0.1, 0.1, 0, 0, 0, 0]), v([0.7, 0.7, 0.2, 0.1, 0.1, 0, 0, 0])];
  const query = [topicX];
  const expect = { a: 'короткая побеждает', b: 'длинная побеждает' };
  const sLongA = scorePair('a', query, longNote), sShortA = scorePair('a', query, shortNote);
  const sLongB = scorePair('b', query, longNote), sShortB = scorePair('b', query, shortNote);
  const sLongC = scorePair('c', query, longNote), sShortC = scorePair('c', query, shortNote);
  const sLongD = scorePair('d', query, longNote), sShortD = scorePair('d', query, shortNote);
  console.log(`a центроид: длинная ${sLongA.toFixed(3)} vs короткая ${sShortA.toFixed(3)} → ${sShortA > sLongA ? expect.a : 'не подтвердилось'}`);
  console.log(`b max-пар:  длинная ${sLongB.toFixed(3)} vs короткая ${sShortB.toFixed(3)} → ${sLongB > sShortB ? expect.b : 'не подтвердилось'}`);
  console.log(`c центроид×чанк: длинная ${sLongC.toFixed(3)} vs короткая ${sShortC.toFixed(3)}`);
  console.log(`d top-2:    длинная ${sLongD.toFixed(3)} vs короткая ${sShortD.toFixed(3)}`);
  // скорость: 300 заметок × 30 чанков против 5 чанков, 4096 измерений
  const D = 4096, NOTES = 300, CH = 30;
  const rnd = () => Math.random() - 0.5;
  const big = Array.from({ length: NOTES }, () => Array.from({ length: CH }, () => Array.from({ length: D }, rnd)));
  const q = Array.from({ length: 5 }, () => Array.from({ length: D }, rnd));
  for (const variant of VARIANTS) {
    const t0 = performance.now();
    let acc = 0;
    // eslint-disable-next-line no-unused-vars -- LS-1: аккумулятор нужен, чтобы V8 не выбросил scorePair из замера
    for (const note of big) acc += scorePair(variant, q, note);
    const ms = performance.now() - t0;
    console.log(`  ${variant}: 300 заметок × ${CH} чанков против ${q.length}, dim ${D} — ${ms.toFixed(1)} мс ${ms < 100 ? '(бюджет 100 мс выдержан)' : '(СВЫШЕ бюджета)'}`);
  }
}

// ── прогон ───────────────────────────────────────────────────────────────────
if (args.selftest) {
  selftest();
  process.exit(0);
}


const all = [...QUERIES, ...CORPUS];
const CACHE = path.join(HERE, '.cache', `related-days-vectors.${fingerprint(all)}.json`);
if (args.sizes) {
  for (const n of all) console.log(`${n.id}\t${n.kind}\t${n.body.length} зн.\t${chunkText(n.body).length} чанков`);
  process.exit(0);
}

let perNote = [];
let cost = 0;
if (existsSync(CACHE) && !args.fresh) {
  perNote = JSON.parse(readFileSync(CACHE, 'utf8'));
  console.error(`кэш векторов: ${perNote.length} заметок из ${CACHE}`);
} else {
  const dim = [];
  for (const note of all) {
    const r = await vectorsFor(note);
    perNote.push(r);
    cost += r.cost;
    dim.push(r.vectors[0]?.length ?? 0);
    console.error(`${r.id}: ${r.chunks.length} чанков, dim ${r.vectors[0]?.length}, токенов ${r.tokens}, $${r.cost.toFixed(5)}`);
  }
  if (new Set(dim).size !== 1) { console.error(`размерность не одинаковая: ${dim.join(', ')}`); process.exit(1); }
  mkdirSync(path.dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(perNote));
  console.error(`размерность прод-модели: ${dim[0]} | cost $${cost.toFixed(4)} | кэш: ${CACHE}`);
}
const notesForCorpus = perNote.filter(n => n.kind !== 'query' || true);
console.log(analyse(notesForCorpus));
