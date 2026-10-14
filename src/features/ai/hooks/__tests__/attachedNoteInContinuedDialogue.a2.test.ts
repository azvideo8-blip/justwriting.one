// A-2 (0.9.34): приложенная заметка в продолженном диалоге — что реально уходит в /api/chat.
//
// Случай с прода: в уже идущий диалог (6 прошлых ходов о заметке A, у диалога
// documentId = A) человек приложил заметку B и попросил глубокий разбор с разных
// сторон. Ответ вышел не по B. Юнит прогоняет этот случай
// через настоящие хуки (useAIChat + useAIChatContext, фейковый IndexedDB) и
// фиксирует состав запроса: documentContent, noteScope, историю, портрет, память.
//
// Гипотезы тикета проверяются отдельными ассертами:
// (а) история прошлых ходов уходит в запрос (подтверждена: 13 реплик, 11 082 зн.);
// (б) в строгом ходе блок заметки — последний фенс (A-3, V1: до правки портрет
//     стоял ближе к реплике, и на замере часть ответов уезжала в тему A);
// (в) в documentContent только B и noteScope назван B (не подтверждена и до правки).
//
// Тексты заметок, портрета и истории — синтетика, выдуманная для теста.
//
// Мутации, на которых тест краснеет: вернуть в buildChatPrompt.ts блок заметки
// перед портретом → (б) красный; вернуть полное сообщение истории (без V1 это
// всё равно было 13 реплик, поэтому (а) — документация формы, а не регрессия).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { AIProfileService } from '../../services/AIProfileService';
import { noteMetaFor } from '../../utils/noteMeta';
import { assembleChatPromptParams, buildChatSystemPrompt } from '../../../../shared/ai/buildChatPrompt';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ language: 'ru', t: (k: string) => k }),
}));

const DOC_A = 'local_a2_note_a';
const DOC_B = 'local_a2_note_b';
const DIALOGUE_ID = 'd_a2_continued';
const DAY_A = '20260929';
const DAY_B = '20261008';
const TITLE_A = 'Десять тысяч шагов';
const TITLE_B = 'Разговор с руководителем про сроки';
const QUESTION = 'разобрать подробно, с нескольких сторон';

// Синтетика: маркеры тем подобраны так, чтобы их нельзя было спутать ни друг с
// другом, ни с портретом.
const A_MARK = 'ПРАВИЛО А: десять тысяч шагов в день без исключений';
const NOTE_A = [
  `Утром снова вышел на круг вокруг дома. ${A_MARK} — придумал ещё в августе и с тех пор ни разу не отступил, даже когда дождь.`,
  'К вечеру правое колено ныло, но я всё равно прошёлся до сквера и обратно: пока иду, думать легче, чем сидеть над списком дел.',
  'Мила сказала, что я защищаюсь этой нормой от всего остального — возможно, она права, но без неё день расползается.',
  'Записал, что на работе снова перенесли сроки, и меня это почему-то не злит: злюсь только на себя за то, что встаю в шесть.',
].join('\n');

const B_MARKS = ['ТЕМА Б1', 'ТЕМА Б2', 'ТЕМА Б3', 'ТЕМА Б4', 'ТЕМА Б5'] as const;
// ~6 000 знаков, как заметка с прода (около 2 000 токенов): короткая заметка
// меряла бы не тот случай.
function noteB(): string {
  const topics: Array<[string, string, string[]]> = [
    ['ТЕМА Б1', 'репетиция разговора с руководителем про сроки', [
      'Я трижды проговорил вслух одну и ту же фразу про перенос срока, и каждый раз начинал с извинения.',
      'Заметил, что заранее приписываю руководителю тон, которого он ни разу не брал: «опять срываете план».',
      'Попробовал другую формулировку — сначала факт, потом предложение, потом вопрос. Звучит короче и спокойнее.',
      'Решил, что на разговоре буду держать перед глазами одну строку, а не весь список, чтобы не сваливаться в оправдания.',
      'Набросал три фразы, которые хочу сказать, и вычеркнул из них «к сожалению» — это слово открывает оправдание.',
      'Отдельно записал: если меня перебивают, я теряю нить и начинаю соглашаться с любым вариантом.',
      'Вспомнил прошлый разговор: тогда я согласился на срок, который знал как нереальный, и молчал две недели.',
      'Хочу проверить, смогу ли назвать дату, назвав сначала причину, а не вину.',
      'Повторил вслух дважды подряд, чтобы голос не дрогнул на первой же паузе.',
      'Потренировал паузу в три секунды после его вопроса — раньше заполнял её сразу.',
      'Выписал, какие две вещи я готов уступить по сроку и какую одну — нет.',
      'Заметил, что формулирую задачу как просьбу разрешить, а не как план работ.',
      'После каждой репетиции остаётся ощущение, что я не досказал главное.',
    ]],
    ['ТЕМА Б2', 'вечерние сорок минут на чтение вслух', [
      'Вечером отложил телефон в другую комнату и сорок минут читал вслух, почти без перерыва.',
      'Голос сбивается на быстрых местах, и именно там я обычно проваливаюсь в молчание на совещаниях.',
      'После чтения записал три фразы, которые хочется иметь в запасе; одна из них про цену спешки.',
      'Мешает не усталость, а ощущение, что я занимаюсь собой вместо полезного дела.',
      'К двадцатой минуте темп падает, и я начинаю глотать окончания — это слышно на записи.',
      'Записал один абзац на диктофон и переслушал: со стороны видно, где я ухожу в оправдания.',
      'Хочу дойти до того, чтобы читать вслух не готовый текст, а свои заметки как есть.',
      'На третий вечер попробовал читать стоя — пауза держится легче.',
      'Мешает и стыд: выглядит как репетиция спектакля, а не как работа.',
      'Пробовал читать по ролям — выходит хуже, чем просто вслух своими словами.',
      'Отмечаю места, где приходится перечитывать: там я обычно теряю мысль на встрече.',
      'К концу недели стало заметно, что начинаю фразу увереннее, чем неделю назад.',
      'Записал, что мешает не голос, а спешка: я тороплюсь закончить предложение.',
    ]],
    ['ТЕМА Б3', 'спор с братом про ремонт в квартире', [
      'Брат уверен, что менять проводку нужно сейчас, я — что зимой дороже и холоднее.',
      'Спорили дважды и оба раза заканчивали тем, что он говорит: «тебе проще не начинать».',
      'В этом есть доля правды: я откладываю решение, пока оно не становится срочным.',
      'Договорились посчитать два варианта до выходных и встретиться только с цифрами, без аргументов.',
      'Считал два бюджета в уме и оба раза сбивался на «зимой дороже», хотя цифр не помню.',
      'Понял, что злит меня не ремонт, а то, что решение принимается за меня.',
      'Брат прав в одном: откладывая, я плачу дважды.',
      'Записал: до выходных собрать две сметы, иначе разговор снова уйдёт в характеры.',
      'Договорились созвониться в четверг и говорить только по цифрам.',
      'Вспомнил, как в прошлый раз мы год не обсуждали ремонт, и всё решилось за один вечер.',
      'Мне важно, чтобы срок работ назывался цифрой, а не «как получится».',
      'Попробовал написать ему сообщение вместо звонка — текст вышел примирительным и бесполезным.',
      'Спор про провода легко переходит в разговор про то, кто в семье решает.',
    ]],
    ['ТЕМА Б4', 'план на отпуск — поезд на север', [
      'Хочу четыре дня в маленьком городе на воде: без плана, с одной книгой и записной книжкой.',
      'Прошлый отпуск я потратил на переезды и на то, чтобы всё успеть посмотреть, и вернулся выжатый.',
      'Боюсь, что буду скучать к третьему дню; в прошлые раза скучал ровно к третьему дню.',
      'Поэтому беру с собой одну задачу на весь отпуск: разобрать записи за лето.',
      'Посмотрел билеты: поезд ночной, утра в дороге почти нет, зато есть четыре дня без плана.',
      'Хочу проверить, смогу ли я четыре дня ничего не решать.',
      'От прошлой поездки осталось шесть исписанных страниц и ни одной законченной мысли.',
      'К третьему дню обычно начинаю листать ленту в телефоне — в этот раз телефон оставлю в номере.',
      'Главное условие: не брать с собой ноутбук, иначе отпуск превратится в работу по вечерам.',
      'Прошлой осенью ездил на три дня и вернулся отдохнувшим — тогда плана тоже не было.',
      'Записал, что первые два дня без дела даются мне тяжелее всего, и это надо просто переждать.',
      'Хочу встать там в семь утра и посмотреть, куда денется день.',
      'Из вещей — одна сумка, иначе я тащу работу в поездку.',
    ]],
    ['ТЕМА Б5', 'привычка откладывать звонки', [
      'Три звонка висят у меня неделями: мастеру, врачу и старому приятелю, который помог с переездом.',
      'Каждый раз я придумываю, что сейчас неудобное время, и это всегда правда ровно на один день.',
      'Понял, что тяжелее всего начать первые две секунды, а не весь разговор.',
      'Правило на эту неделю: один звонок до девяти утра, прежде чем я успею придумать причину.',
      'Мастеру не звоню, потому что заранее уверен: он скажет, что нужно дороже.',
      'Врача откладываю со второй прививки; причина каждый раз звучит разумно.',
      'Приятелю должен за ответ про переезд, и чем дольше молчу, тем страннее начинать.',
      'Написанные сообщения я стираю, так и не отправив — проверял трижды за неделю.',
      'Заметил, что после звонка всегда легче, и ни разу не пожалел о самом разговоре.',
      'Проверил: на звонок уходит четыре минуты, а на ожидание — недели.',
      'Выписал три номера и поставил их в календарь на утро вторника.',
      'Мне легче звонить, если заранее известно, чем закончить разговор.',
      'Стыд после незакрытого звонка сильнее страха до него — именно он и держит.',
    ]],
  ];
  return topics.map(([mark, title, lines]) => `${mark}: ${title}\n${lines.join(' ')}`).join('\n\n');
}
const NOTE_B = noteB();

// PX-1: в строгом ходе от портрета остаётся раздел «Стиль общения», поэтому
// фикстура — продовый формат (пять разделов с заголовками `## …`), а не одна
// строка: иначе строгий ход идёт без портрета и порядок фенсов нечего проверять.
const PORTRAIT = '# Психологический портрет пользователя\n\n'
  + '## Темы и интересы\nГлавное в записях — бег и выносливость; человек пишет по вечерам.\n\n'
  + '## Эмоциональные паттерны\nРаздражение копится молча и выходит задним числом.\n\n'
  + '## Сильные стороны\nДоводит начатое до конца, если шаг назван.\n\n'
  + '## Зоны роста\nПросит о помощи поздно.\n\n'
  + '## Стиль общения\nПОРТРЕТ МАРАФОН: обращение на «ты», ценит точность формулировок и не любит ободрения.\n';

const PAST_QUESTIONS = [
  'разбери мою норму по шагам',
  'а что тут про колено?',
  'прав ли я, что встаю в шесть?',
  'что Мила имеет в виду?',
  'с чем связано раздражение?',
  'собери вывод в три пункта',
];

// Длины прошлых ответов — продовые: prepareApiMessages режет старые ответы до
// 1 500 знаков, последние два уходят целиком. Иначе кейс-rests был бы дешевле
// настоящего и замер «до/после» мерил бы не то.
const A_ANSWER_LINES = [
  'Твоя норма в десять тысяч шагов держит день целиком, и это видно по тому, как ты описываешь утро.',
  'К вечеру колено ноет, но круг до сквера ты всё равно проходишь — правило не обсуждается даже с болью.',
  'Мила называет это защитой; в тексте есть и про перенос сроков на работе, и про то, что злишься ты на себя.',
  'Встаёшь в шесть, и это единственное, что ты пока контролируешь в этом дне.',
  'Похоже, дело не в шагах, а в том, что без них день расползается и нечего показать себе вечером.',
  'Отдельно: злишься ты не на руководителя, а на то, что сам себя проверяешь этой нормой.',
  'Если смотреть на привычку, то норма здесь не про тело, а про право сказать себе «я справился».',
  'Хочу спросить: что случится, если один день не дойти до десяти тысяч — что ты тогда себе скажешь?',
];

function padTo(lines: string[], target: number, offset: number): string {
  let out = '';
  let i = offset;
  while (out.length < target) {
    out += (out ? ' ' : '') + lines[i % lines.length]!;
    i++;
  }
  return out;
}

function pastAnswer(i: number): string {
  const target = i >= PAST_QUESTIONS.length - 2 ? 2_200 : 1_500;
  return `Ход ${i + 1}. ${padTo(A_ANSWER_LINES, target, i)}`;
}

function pastTurn(i: number) {
  const user = `[#${DOC_A} · ${DAY_A}]\n[Прикреплена заметка: "${TITLE_A}"]\n${NOTE_A}\n\n— — —\nВопрос: ${PAST_QUESTIONS[i]!}`;
  return [
    { role: 'user' as const, content: user, type: 'chat' as const },
    { role: 'assistant' as const, content: pastAnswer(i), type: 'chat' as const },
  ];
}

function refTag(id: string, day: string, title: string, body: string): string {
  return `[#${id} · ${day}]\n[Прикреплена заметка: "${title}"]\n${body}`;
}

interface Sent {
  messages: { role: string; content: string }[];
  documentContent?: string;
  noteScope?: { mode: string; title: string; date: string };
  userPortrait?: string | null;
  memoryContext?: string | null;
  personaId?: string;
  responseLength?: string;
  reasoning?: boolean;
  crisis?: boolean;
}

async function seedDb() {
  const db = await getLocalDb();
  const now = Date.now();
  const tsA = new Date('2026-09-29T08:00:00+03:00').getTime();
  const tsB = new Date('2026-10-08T09:00:00+03:00').getTime();
  for (const [id, title, ts] of [[DOC_A, TITLE_A, tsA], [DOC_B, TITLE_B, tsB]] as const) {
    await db.put('documents', {
      id, guestId: 'guest', title, currentVersion: 1, totalWords: 200, totalDuration: 600,
      sessionsCount: 1, firstSessionAt: ts, lastSessionAt: ts, tags: [],
    } as never);
    await db.put('versions', {
      id: `v_${id}`, documentId: id, guestId: 'guest', version: 1,
      content: id === DOC_A ? NOTE_A : NOTE_B, wordCount: 200, wordsAdded: 200, charsAdded: 800,
      duration: 600, wpm: 20, savedAt: ts,
    } as never);
  }
  const messages = PAST_QUESTIONS.flatMap((_, i) => pastTurn(i));
  await db.put('aiDialogues', {
    id: DIALOGUE_ID, title: 'Про бег', personaId: 'group_psychology', personaName: 'Группа психологов',
    personaEmoji: '🧠', documentId: DOC_A, createdAt: now, updatedAt: now, messages,
  } as never);
  return { tsB };
}

async function runCase(): Promise<Sent> {
  const { tsB } = await seedDb();
  let sent: Sent | undefined;
  vi.spyOn(transport, 'streamChat').mockImplementation(async o => {
    sent = o as unknown as Sent;
    o.onChunk('фиктивный ответ по ход-кейсу', '');
    return 'фиктивный ответ по ход-кейсу';
  });
  const { result } = renderHook(() => useAIChat(DIALOGUE_ID, 'group_psychology', 'detailed'));
  await waitFor(() => expect(result.current.dialogue?.messages.length).toBe(12));

  const prepared = (await act(async () => result.current.prepareAttachment(DOC_B))) as { title: string; content: string; lastSessionAt?: number };
  expect(prepared?.content).toBe(NOTE_B);

  // копия того, что делает useAIPageData.executeSendMessage при одном вложении
  const content = refTag(DOC_B, DAY_B, TITLE_B, NOTE_B);
  const display = `${content}\n\n— — —\nВопрос: ${QUESTION}`;
  const noteMeta = noteMetaFor({ title: TITLE_B, lastSessionAt: tsB });
  await act(async () => {
    await result.current.sendMessage(display, { content, documentId: DOC_B, inline: true }, undefined, undefined, { question: QUESTION, noteMeta });
  });
  expect(sent, 'запрос не ушёл').toBeDefined();
  return sent!;
}

// Подборка примеров открытых вопросов в промпте случайна от хода к ходу
// (DLG-Q2), поэтому длина системного промпта гуляет на ~60 знаков. Для таблицы
// формы сид фиксирован: цифры воспроизводимы.
const SEEDED_RND = () => 0.42;

function fenceOffsets(sent: Sent): { note: number; portrait: number; memory: number } {
  const system = buildChatSystemPrompt({
    ...assembleChatPromptParams({
      personaId: sent.personaId ?? 'group_psychology',
      documentContent: sent.documentContent ?? null,
      userPortrait: sent.userPortrait ?? null,
      memoryContext: sent.memoryContext ?? null,
      noteScope: sent.noteScope as never,
      responseLength: (sent.responseLength as 'short' | 'standard' | 'detailed' | null | undefined) ?? 'detailed',
      reasoning: sent.reasoning ?? false,
      crisis: sent.crisis ?? false,
    }),
    rnd: SEEDED_RND,
  });
  const note = system.lastIndexOf(`[#${DOC_B} · ${DAY_B}]`);
  // фенс портрета ищется по шапке ограды: в строгий ход едет только раздел, а не весь текст
  const portrait = system.indexOf('данные профиля пользователя');
  return { note, portrait, memory: system.indexOf('данные памяти о пользователе') };
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  transport._resetStreamUnavailable();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false });
  vi.spyOn(AIProfileService, 'getPortrait').mockResolvedValue(PORTRAIT);
});

describe('A-2: приложенная заметка в продолженном диалоге', () => {
  it('(в) в documentContent только B, и noteScope назван B', async () => {
    const sent = await runCase();
    const doc = sent.documentContent ?? '';
    for (const mark of B_MARKS) expect(doc).toContain(mark);
    expect(doc).not.toContain('ПРАВИЛО А');
    expect(doc).not.toContain('десять тысяч шагов');
    expect(doc.match(/^\[#/gm)).toHaveLength(1);
    expect(doc).toContain(`[#${DOC_B} · ${DAY_B}]`);
    expect(sent.noteScope?.mode).toBe('note');
    expect(sent.noteScope?.title).toBe(TITLE_B);
    expect(sent.memoryContext).toBeNull();
    expect(sent.crisis).toBe(false);
  });

  it('(а) прошлые ходы об A уходят в запрос целиком', async () => {
    const sent = await runCase();
    const historyChars = sent.messages.reduce((s, m) => s + m.content.length, 0);
    const withTitleA = sent.messages.filter(m => m.content.includes(TITLE_A));
    const assistants = sent.messages.filter(m => m.role === 'assistant');
    expect(sent.messages.length).toBe(13);
    // 6 прошлых реплик называют заметку A; текущая реплика называет B
    expect(withTitleA.length).toBe(6);
    expect(assistants.length).toBe(6);
    // продовый порядок величины: 6 прошлых ответов ≈ 3–4 тыс. токенов входных
    expect(historyChars).toBeGreaterThan(10_000);
    // старые ответы урезаны до 1 500, последние два — нет (prepareApiMessages)
    expect(assistants.slice(0, 4).every(m => m.content.length <= 1_500)).toBe(true);
    expect(assistants.at(-1)!.content.length).toBeGreaterThan(1_500);
    // тело A в историю не ездит (R3-007), но тема A — в каждом ходе
    expect(sent.messages.map(m => m.content).join('\n')).not.toContain('ПРАВИЛО А');
  });

  it('(б) в строгом ходе блок заметки — последний фенс, портрет больше не ближе к реплике', async () => {
    const sent = await runCase();
    const { note, portrait, memory } = fenceOffsets(sent);
    expect(note).toBeGreaterThan(-1);
    expect(portrait).toBeGreaterThan(-1);
    // A-3 (V1): заметка идёт после портрета и памяти — последним перед репликой
    expect(note).toBeGreaterThan(portrait);
    expect(note).toBeGreaterThan(memory);
  });

  it('таблица состава запроса (в отчёт) и JSON кейса для живого харнесса', async () => {
    const sent = await runCase();
    const doc = sent.documentContent ?? '';
    const historyChars = sent.messages.reduce((s, m) => s + m.content.length, 0);
    const system = buildChatSystemPrompt({
      ...assembleChatPromptParams({
        personaId: sent.personaId ?? 'group_psychology',
        documentContent: doc,
        userPortrait: sent.userPortrait ?? null,
        memoryContext: sent.memoryContext ?? null,
        noteScope: sent.noteScope as never,
        responseLength: 'detailed',
        reasoning: false,
        crisis: false,
      }),
      rnd: SEEDED_RND,
    });
    const shape = {
      persona: sent.personaId,
      scope: sent.noteScope?.mode ?? null,
      scopeTitleIsB: sent.noteScope?.title === TITLE_B,
      crisis: sent.crisis ?? false,
      msgs: sent.messages.length,
      msgsAssistant: sent.messages.filter(m => m.role === 'assistant').length,
      msgsWithTitleA: sent.messages.filter(m => m.content.includes(TITLE_A)).length,
      histChars: historyChars,
      docChars: doc.length,
      docNoteBlocks: (doc.match(/^\[#/gm) ?? []).length,
      portraitChars: (sent.userPortrait ?? '').length,
      memoryChars: (sent.memoryContext ?? '').length,
      systemChars: system.length,
      noteFenceAt: system.lastIndexOf(`[#${DOC_B} · ${DAY_B}]`),
      portraitFenceAt: system.indexOf('данные профиля пользователя'),
    };
    console.log('A2_SHAPE ' + JSON.stringify(shape));
    if (process.env.A2_DUMP_CASE) console.log('A2_CASE ' + JSON.stringify(sent));
    expect(shape.docNoteBlocks).toBe(1);
    expect(shape.noteFenceAt).toBeGreaterThan(shape.portraitFenceAt);
  });
});
