// W-1 (дополнение тикета): инвариант, а не отдельный случай.
//
// F-1 жил с июля, потому что один модуль (temporalBlocks.ts) молча отменял
// поиск, который другой модуль (shouldRunFullSearch) уже решил запускать, и
// конечный результат никто не сверял. Тест берёт весь корпус классификации хода
// §4.3 и каждый ход, который помечен как явный поиск, проверяет на конце цепочки:
// в теле запроса обязан лежать либо блок найденных заметок, либо явное
// «ничего не нашлось». Ни того и ни другого — инвариант нарушен, и неважно,
// какой модуль отменил поиск.
//
// Ходы, где shouldRunFullSearch ложен, не проверяются: догоняющий ход и светская
// реплика права пропустить поиск.
//
// Формулировки придуманы для теста (корпус §4.3 синтетический), живых реплик и
// заметок владельца здесь нет.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import 'fake-indexeddb/auto';

import { useAIChat } from '../useAIChat';
import { getLocalDb } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { shouldRunFullSearch } from '../../utils/aiChatTransport';
import { parseTemporalQuery } from '../../utils/temporalQueryParser';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { AIService } from '../../services/AIService';
import * as noteRetriever from '../../utils/noteRetriever';
import { invalidateMiniSearchCache } from '../../utils/retrieval/indexCache';
import { invalidateEmbeddingIndexCache } from '../../../../core/services/embeddingIndexCache';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ language: 'ru', t: (k: string) => k }),
}));

// Корпус §4.3 (155 реплик из таблицы классификации postProcessing.audit43) плюс
// 20 новых, где глагол поиска смешан с хронологической и догоняющей формулировкой.
const CLASS43: string[] = [
  'привет',
  'как дела?',
  'спасибо, всё понятно',
  'сегодня дождь',
  'разбери эту заметку',
  'что главное в этой заметке?',
  'сделай пост по моей записи',
  'перепиши этот абзац короче',
  'в этой записи я путаю даты',
  'Что здесь главное?',
  'сравни с прошлой неделей',
  'было ли так раньше?',
  'это у меня повторяется?',
  'видишь паттерн?',
  'что в других записях про это',
  'посмотри в других заметках',
  'как обычно я на это реагирую?',
  'во всех записях про этот день',
  'в моём дневнике это было?',
  'в старых записях было похожее?',
  'собери из всех заметок',
  'вытащи цитату из прошлых заметок',
  'найди похожие на эту запись',
  'поищи что-нибудь похожее',
  'есть у меня ещё что-то про это?',
  'поищи в заметках про Веру',
  'что я писал про огород',
  'вспомни, что я думал про плитку',
  'что я писал год назад про бег?',
  'когда я в последний раз писал про море',
  'сколько записей про работу за месяц',
  'сегодня был сложный день, устал',
  'меня бесит, что я откладываю ремонт',
  'как мне перестать откладывать?',
  'что делать с тревогой по утрам',
  'почему я так злюсь на начальника',
  'мне кажется, я всё порчу',
  'хочу научиться вставать раньше',
  'разбери',
  'это моя заметка про пробежку',
  'что тут не так?',
  'допиши концовку',
  'оставь только факты',
  'по этой заметке сделай план недели',
  'что мне делать с часами?',
  'как это связано с отцом?',
  'эта запись — про страх или про лень?',
  'в записях про это же время год назад',
  'собери из всех заметок список дел',
  'что общего у моих записей про спорт',
  'найди записи, где я сомневался',
  'что я писал про Виталия',
  'покажи мои мысли про отпуск',
  'было у меня похожее с Верой',
  'ну ок',
  'ясно, спасибо',
  'и что мне с этим делать',
  'опечатка: завтpа встpечa',
  'я не знаю, с чего начать',
  'мне нужно решение, а не вопросы',
  'сравнu эти две записи между собой',
  'а в более ранних записях?',
  'и в других заметках так же?',
  'продолжи мысль',
  'перефразируй мягче',
  'убри повторы из текста',
  'это хорошая формулировка?',
  'что бы ты поправил в этом абзаце',
  'проверь, нет ли тут выдумки',
  'во сколько записей это вошло',
  'есть у меня про это что-нибудь',
  'собери всё про огород за лето',
  'что я думал об этом в марте',
  'вспомни мои слова про тренеровку',
  'что я раньше думал про эту работу',
  'есть похожая ситуация в архиве',
  'найти похожее',
  'похожее было?',
  'а раньше?',
  'а в других записях',
  'то же самое в других местах?',
  'это только сейчас или всегда?',
  'да',
  'нет',
  'не знаю',
  'может, и так',
  'расскажи про меня честно',
  'что ты вообще обо мне понял',
  'какой у меня паттерн с работой',
  'из моих записей видно, что я…',
  'в моих текстах это есть?',
  'в дневнике про это было?',
  'сколько раз я это повторяю',
  'назови три мои темы',
  'что у меня меняется от года к году',
  'когда мне было легче всего',
  'самая спокойная моя запись',
  'что я писал после ссоры',
  'что я обычно пишу по понедельникам',
  'дай обратную связь по тексту',
  'что усилить, что убрать',
  'сделай плотнее на треть',
  'оставь стиль, поправь ритм',
  'это читается как оправдание?',
  'сократи вдвое',
  'начни с сильной фразы',
  'убери канцелярит',
  'проверь факты в тексте',
  'есть ли такое в других моих заметках',
  'напиши продолжение',
  'в каком месте слабее всего',
  'прочти это как редактор',
  'что тут моё, а что придумано',
  'я сегодня не пришёл на тренировку',
  'плитка приехала, но не та',
  'разговор с руководителем снова отменили',
  'Вера опять недовольна ремонтом',
  'Вера?',
  'и что дальше',
  'устал',
  'всё',
  'сегодня всё получилось',
  'опять сорвался',
  'поссорились с Верой',
  'запись не вышла',
  'вот этот абзац лишний',
  'уберу это',
  'оставь только два предложения',
  'сделай заголовок',
  'а теперь сузь',
  'проверь, нет ли выдумки',
  'в других моих записях про это',
  'что я писал раньше на эту тему',
  'спроси у архива',
  'открой старые заметки про море',
  'собери мои записи про бег',
  'что я думал про это раньше',
  'было похоже год назад',
  'есть у меня где-то про это',
  'а в записях за август',
  'посмотри хронику за неделю',
  'сколько раз я это повторяю в записях',
  'архив про это что-то знает',
  'отыщи записи про тренеровки',
  'что говорят мои заметки про сон',
  'ну не знаю',
  'вроде того',
  'согласен',
  'не согласен',
  'давай по короче',
  'подробнее про этот абзац',
  'а теперь про другой кусок',
  'тут правда или придумал',
  'из всех моих записей собери список',
  'что общего у записей про дачу',
];
const SEARCH_TEMPORAL_W1: string[] = [
  'поищи в заметках, что у меня было с работой',
  'найди в записях, что у меня было в сентябре',
  'посмотри в заметках, что у меня было на прошлой неделе',
  'поищи, что у меня было с Верой на прошлой неделе',
  'найди в архиве, что у меня было вчера',
  'вспомни, что у меня было в сентябре',
  'поищи в заметках и напомни, что у меня было с дачей',
  'что у меня было на прошлой неделе — поищи в заметках',
  'напомни, что я писал про ремонт в сентябре',
  'посмотри в записях, что было вчера с пробежками',
  'найди, что у меня было с поездкой на прошлой неделе',
  'поищи вчерашнюю заметку про стоматолога',
  'вспомни, что у меня было в августе с рекой',
  'посмотри в архиве, что у меня было на прошлой неделе с бюджетом',
  'поищи и напомни, что было в сентябре с дачей',
  'что у меня было вчера — найди в заметках',
  'найди в записях, что у меня на прошлой неделе не получалось',
  'посмотри, что у меня было в марте с работой',
  'вспомни по заметкам, что было на прошлой неделе с тренировками',
  'поищи, что у меня было с ремонтом в сентябре и на прошлой неделе',
];

const DIALOGUE_ID = 'd_w1_invariant';
const FOUND_BLOCK = 'Результаты поиска по архиву заметок';
const NOTHING_FOUND = 'по этому запросу в базе ничего не нашлось';
const SEARCH_FAILED = 'Поиск по базе не удался';

// Инвариант нарушает не только «что у меня». Эти четыре хода отменяет другой
// модуль: предикат noteAnalysisIntent (aiChatContext.ts:241–242) считает реплику
// со словами «заметк/запис» + «посмотр/разбер/прочит» без вложения ходом «разбери
// заметку», и на :355 весь блок поиска не выполняется. Вне рамок W-1 не чинится,
// записи уходят в отчёт как отдельные находки. Держим их списком, чтобы
// инвариант ловил ЛЮБОГО нового отменителя, а починка чужого модуля заставила
// сократить список.
const CANCELLED_BY_OTHER_MODULE: Record<string, string> = {
  'разбери эту заметку': 'aiChatContext.ts:241,355 — строгий ход без приложенной заметки, ожидание партии A',
  'посмотри в других заметках': 'aiChatContext.ts:241,355 — DLG-Q7 без якоря, тот же предикат',
  'посмотри в заметках, что у меня было на прошлой неделе': 'aiChatContext.ts:241,355 — явный поиск по архиву проглочен предикатом «разбери заметку»',
  'посмотри в записях, что было вчера с пробежками': 'aiChatContext.ts:241,355 — то же: окно дат + просьба посмотреть, архив не поднят',
};

// Синтетический архив из 10 заметок: темы разные, имена выдуманы.
const NOTES: Array<[string, string, string]> = [
  ['local_w1_1', 'Пробежка вечером', 'Решила бегать по вечерам, темп медленный, но я не останавливалась.'],
  ['local_w1_2', 'Кухня и ремонт', 'Плитку выбрали, подрядчик обещал четверг, остаток бюджета неизвестен.'],
  ['local_w1_3', 'Отчёт за квартал', 'Свела цифры по отделу, половину пришлось пересчитать заново.'],
  ['local_w1_4', 'Дача с Верой', 'Вера предложила разбить грядки, я отложила до выходных.'],
  ['local_w1_5', 'Звонок маме', 'Мама звала переезжать ближе к ней, я пообещала подумать.'],
  ['local_w1_6', 'Стоматолог', 'Записалась на приём через две недели: сначала снимок, потом лечение.'],
  ['local_w1_7', 'Бюджет на сентябрь', 'Отложила сумму на курс, остальное ушло на ремонт и продукты.'],
  ['local_w1_8', 'Вечер с книгой', 'Дочитала главу про привычки, утром вспомнила только про сигнал и награду.'],
  ['local_w1_9', 'Поездка на реку', 'Собрались на реку на субботу, дождь перенёс всё на воскресенье.'],
  ['local_w1_10', 'Тренировка в зале', 'Три подхода по десять, ноги гудели, тренер просил не торопить вес.'],
];

function vecOf(text: string): number[] {
  const v = new Array(24).fill(0);
  for (const ch of text) v[(ch.codePointAt(0) ?? 0) % 24] += 1;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map(x => x / n);
}

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'versions', 'aiDialogues', 'aiEmbeddings', 'aiSummaries'] as const) {
    await db.clear(store);
  }
  const base = Date.UTC(2026, 8, 20, 8, 0);
  for (const [i, [id, title, body]] of NOTES.entries()) {
    const at = base + i * 3_600_000;
    await db.put('documents', {
      id, guestId: 'guest', title, currentVersion: 1, totalWords: 40, totalDuration: 300,
      sessionsCount: 1, firstSessionAt: at, lastSessionAt: at, tags: [],
    } as never);
    await db.put('versions', {
      id: `v_${id}`, documentId: id, guestId: 'guest', version: 1, content: body,
      wordCount: 40, wordsAdded: 40, charsAdded: body.length, duration: 300, wpm: 20, createdAt: at,
    } as never);
    await db.put('aiEmbeddings', {
      documentId: id, vectors: [vecOf(body)], chunkTexts: [body],
      model: 'BAAI/bge-m3', dim: 24, contentHash: '', processedAt: at, schemaV: 3, cloudSyncedAt: at,
    } as never);
  }
  await db.put('aiDialogues', {
    id: DIALOGUE_ID, title: 'Инвариант W-1', personaId: 'coach', personaName: 'Коуч',
    personaEmoji: '🎯', createdAt: base, updatedAt: base, messages: [],
  } as never);
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  transport._resetStreamUnavailable();
  invalidateMiniSearchCache();
  invalidateEmbeddingIndexCache();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  useAiLimitStore.setState({
    remaining: 500, limit: 500, used: 0, resetsAt: new Date(Date.now() + 600_000), loaded: true, isAdmin: false,
    reasoningRemaining: 500, reasoningLimit: 500, reasoningUsed: 0,
  });
  setIndexingConsent('guest', 'granted');
});

describe('W-1: явный поиск обязан кончиться архивом или честным «не нашлось»', () => {
  it('весь корпус §4.3 + 20 смешанных ходов: инвариант держится на каждом ходу', async () => {
    await seed();
    const captured: Array<{ documentContent?: string }> = [];
    vi.spyOn(transport, 'streamChat').mockImplementation(async o => {
      captured.push(o as { documentContent?: string });
      o.onChunk('фиктивный ответ инварианта', '');
      return 'фиктивный ответ инварианта';
    });
    vi.spyOn(AIService, 'embed').mockImplementation(async (arg: unknown) => {
      const texts = typeof arg === 'string' ? [arg] : [String((arg as { content?: string }).content ?? '')];
      return { ok: true, vectors: texts.map(vecOf), model: 'BAAI/bge-m3', dim: 24 } as never;
    });
    vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'no quota' } as never);

    // Второе крыло инварианта: поиск не просто «не отменён» — он реально
    // запускался. Полноценный поиск идёт с запросом = текст хода (aiChatContext,
    // searchQuery = effectiveQuery); дополнительный поиск по человеку зовёт
    // searchNotesMulti с именем, поэтому сверяем именно реплику.
    const searchCalls: string[][] = [];
    const realSearch = noteRetriever.searchNotesMulti;
    vi.spyOn(noteRetriever, 'searchNotesMulti').mockImplementation(async (queries, topK, opts) => {
      searchCalls.push([...queries]);
      return realSearch(queries, topK, opts);
    });

    const { result } = renderHook(() => useAIChat(DIALOGUE_ID, 'coach', 'standard'));
    await waitFor(() => expect(result.current.dialogue?.messages.length).toBe(0));

    const corpus = [...CLASS43, ...SEARCH_TEMPORAL_W1];
    const checked: string[] = [];
    const violated: Array<{ text: string, temporal: string, why: string }> = [];
    for (const text of corpus) {
      localStorage.removeItem('jw_ai_cooldown_until');
      localStorage.removeItem('jw_ai_inflight');
      captured.length = 0;
      searchCalls.length = 0;
      await act(async () => { await result.current.sendMessage(text); });
      if (!shouldRunFullSearch(text, false)) continue;
      checked.push(text);
      const doc = captured[captured.length - 1]?.documentContent ?? '';
      const hasBlock = doc.includes(FOUND_BLOCK) || doc.includes(NOTHING_FOUND) || doc.includes(SEARCH_FAILED);
      const ranSearch = searchCalls.some(qs => qs.some(q => q.includes(text)));
      const why = !ranSearch && !hasBlock
        ? 'поиск отменён и «не нашлось» не написано'
        : !ranSearch ? 'поиск не запускался, а в запросе лежит честное «не нашлось»'
        : !hasBlock ? 'поиск прошёл, но в запросе нет ни найденного, ни «не нашлось»'
        : '';
      if (why) violated.push({ text, temporal: parseTemporalQuery(text).type, why });
    }

    const unexpected = violated.filter(v => !(v.text in CANCELLED_BY_OTHER_MODULE));
    const stillCancelled = Object.keys(CANCELLED_BY_OTHER_MODULE).filter(t => violated.some(v => v.text === t));
    console.log('W1_INVARIANT ' + JSON.stringify({
      корпус: corpus.length,
      проверено: checked.length,
      нарушено: violated.length,
      изнихизвестно: stillCancelled,
      новые: unexpected.map(v => `${v.text} [хронология: ${v.temporal}; ${v.why}]`),
    }));
    expect(unexpected.map(v => `${v.text} [хронология: ${v.temporal}; ${v.why}]`)).toEqual([]);
    // Список известного протухает вместе с правкой: починят модуль — убери строку.
    expect(stillCancelled).toEqual(Object.keys(CANCELLED_BY_OTHER_MODULE));
    expect(checked.length).toBeGreaterThan(0);
  }, 420_000);
});
