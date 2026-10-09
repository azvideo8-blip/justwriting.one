// Аудит 0.9.34, область §4.2: приватность скрытых и удалённых заметок.
//
// Проверяется то, что обещает код и чейнджлог: заметка, скрытая от ИИ
// (`excludedFromAI`) или лежащая в корзине (`trashedAt`), не должна попасть ни в
// один канал запроса — ни телом, ни идентификатором. Каналы: семантический поиск,
// ключевой (BM25), лёгкий поиск, запрос «похожие», цитаты человека (свежий блок и
// кэш), открытые планы, темы профиля, память, проактивный блок недавнего,
// временные блоки, а также allowlist цитат.
//
// Два порядка действий: (а) заметка скрыта ДО хода и (б) скрыта МЕЖДУ ходами того
// же диалога — это модель «другая вкладка/другое устройство», где кэш и снимок
// заметок уже прогреты.
//
// Всё содержимое синтетическое, имена выдуманные.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import 'fake-indexeddb/auto';

import { sanitizeCitations, useAIChat } from '../useAIChat';
import { getLocalDb } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { AIProfileService } from '../../services/AIProfileService';
import { AIService } from '../../services/AIService';
import { noteMetaFor } from '../../utils/noteMeta';
import { invalidateMiniSearchCache } from '../../utils/retrieval/indexCache';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { writeFacetStore } from '../../../../core/services/facetLock';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ language: 'ru', t: (k: string) => k }),
}));

const DIALOGUE_ID = 'd_audit42';
const VIS_ID = 'local_42_vis';
const HID_ID = 'local_42_hidden';
const TRASH_ID = 'local_42_trash';
const VIS = 'РАЗРЕШ-ОГОРОД';
const HID = 'ЗАПРЕТ-СКРЫТАЯ';
const TRASH = 'ЗАПРЕТ-КОРЗИНА';
const FORBIDDEN = [HID, TRASH];

const TEXTS: Record<string, string> = {
  // Все три заметки нарочно подходят под один запрос: про Веру, про огород и про
  // плитку. Тогда любой канал, который их не фильтрует, виден сразу.
  [VIS_ID]: `${VIS}: Вера предложила разбить грядки, я отложил. Плитка для дорожки куплена, Вера сказала — вовремя.`,
  [HID_ID]: `${HID}: Вера просила не обсуждать это вслух. Огород и плитка — здесь, но заметка скрыта от ИИ.`,
  [TRASH_ID]: `${TRASH}: Вера расстроилась, огород заброшен, плитка разбита. Запись в корзине.`,
};
const TITLES: Record<string, string> = {
  [VIS_ID]: 'Огород с Верой',
  [HID_ID]: 'Скрытая запись про Веру',
  [TRASH_ID]: 'Корзина: плитка разбита',
};

function vecOf(text: string): number[] {
  const v = new Array(24).fill(0);
  for (const ch of text) v[(ch.codePointAt(0) ?? 0) % 24] += 1;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map(x => x / n);
}

/**
 * @param hideAfter ничего не скрывать на сиде; 'both' — скрыть и выкинуть сразу,
 * 'mid' — посеять видимыми (для проверки между ходами).
 */
async function seed(hideAtStart: boolean) {
  const db = await getLocalDb();
  for (const store of ['documents', 'versions', 'aiEmbeddings', 'aiSummaries', 'aiCommitments',
    'aiTimeline', 'aiDialogues'] as const) await db.clear(store);
  await writeFacetStore(store => store.clear());   // NARROW-2: фасеты — только через писатель
  const ts = Date.now() - 86_400_000;
  for (const [i, id] of [VIS_ID, HID_ID, TRASH_ID].entries()) {
    const body = TEXTS[id] ?? '';
    await db.put('documents', {
      id, uuid: `uuid_42_${i}`, guestId: 'guest', title: TITLES[id], currentVersion: 1,
      totalWords: 30, totalDuration: 300, sessionsCount: 1, firstSessionAt: ts + i * 1000,
      lastSessionAt: ts + i * 1000, tags: [],
      excludedFromAI: hideAtStart && id === HID_ID ? true : undefined,
      trashedAt: hideAtStart && id === TRASH_ID ? ts : undefined,
    } as never);
    await db.put('versions', {
      id: `v_${id}`, documentId: id, guestId: 'guest', version: 1, content: body,
      wordCount: 30, wordsAdded: 30, charsAdded: body.length, duration: 300, wpm: 20, createdAt: ts + i * 1000,
    } as never);
    await db.put('aiEmbeddings', {
      documentId: id, vectors: [vecOf(body)], chunkTexts: [body], model: 'BAAI/bge-m3',
      dim: 24, contentHash: '', processedAt: ts + i * 1000, schemaV: 3, cloudSyncedAt: ts,
    } as never);
    await db.put('aiSummaries', {
      documentId: id, tone: 'тревожный', themes: [`огород ${i}`], insights: [`${id === HID_ID ? HID : id === TRASH_ID ? TRASH : VIS}`],
      extractedFacts: [], frequentWords: [],
    } as never);
    await db.put('aiCommitments', {
      id: `c_${id}`, documentId: id, text: `план из ${id === HID_ID ? HID : id === TRASH_ID ? TRASH : VIS}`,
      status: 'open', createdAt: ts, date: '2026-10-01',
    } as never);
    await db.put('aiTimeline', {
      id: `t_${id}`, documentId: id, date: '20261001', summary: `хроника ${id === HID_ID ? HID : id === TRASH_ID ? TRASH : VIS}`,
    } as never);
  }
  // Тема профиля собрана, когда все три заметки были видны: единственный способ
  // проверить, живёт ли производный текст после сокрытия источников.
  await writeFacetStore(store => store.put({
    id: 'f_42', label: 'Отношения и дача', summary: `Обе темы: ${VIS}, ${HID}, ${TRASH}`,
    centroid: vecOf('Вера огород плитка'), noteIds: [VIS_ID, HID_ID, TRASH_ID],
    primaryNoteIds: [VIS_ID, HID_ID, TRASH_ID], secondaryNoteIds: [], noteCount: 3, chunkCount: 3,
  } as never));
  await db.put('aiDialogues', {
    id: DIALOGUE_ID, title: 'Аудит 42', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    createdAt: ts, updatedAt: ts,
    messages: [
      { role: 'user', content: 'первый ход про огород', createdAt: ts },
      { role: 'assistant', content: 'первый ответ про огород', createdAt: ts + 1 },
      { role: 'user', content: 'второй ход про Веру', createdAt: ts + 2 },
      { role: 'assistant', content: 'второй ответ про Веру', createdAt: ts + 3 },
    ],
  } as never);
  invalidateMiniSearchCache();
}

async function hideMidDialogue() {
  const db = await getLocalDb();
  for (const id of [HID_ID, TRASH_ID]) {
    const doc = await db.get('documents', id);
    await db.put('documents', { ...doc, excludedFromAI: true } as never);
  }
  invalidateMiniSearchCache();
}

interface Sent {
  messages: { role: string; content: string }[];
  documentContent?: string;
  userPortrait?: string | null;
  memoryContext?: string | null;
}

/** Какой блок запроса принёс маркер: ближайшее заглавие блока перед вхождением. */
function carriers(req: string, marker: string): string[] {
  const out = new Set<string>();
  let i = req.indexOf(marker);
  while (i >= 0) {
    const before = req.slice(0, i);
    const heads = [...before.matchAll(/\[[^\]⏎]{3,60}\]|Результаты поиска по архиву|Наблюдение:|— «/g)];
    const last = heads[heads.length - 1];
    out.add(last ? last[0].slice(0, 46) : '(вне заголовков)');
    i = req.indexOf(marker, i + marker.length);
  }
  return [...out];
}

async function turn(text: string, hooks: { result: { current: ReturnType<typeof useAIChat> } }): Promise<Sent> {
  // Клиентский троттлинг хода глобален (useAIChat.ts:387) и ставится после
  // отправки: между двумя вопросами в одном тесте его надо снять.
  localStorage.removeItem('jw_ai_cooldown_until');
  localStorage.removeItem('jw_ai_inflight');
  let sent: Sent | undefined;
  vi.spyOn(transport, 'streamChat').mockImplementation(async (o) => {
    sent = o as unknown as Sent;
    o.onChunk('ответ аудита 42', '');
    return 'ответ аудита 42';
  });
  const noteMeta = noteMetaFor({ title: 'Огород с Верой', lastSessionAt: Date.now() - 86_400_000 });
  await act(async () => { await hooks.result.current.sendMessage(text, undefined, undefined, undefined, { question: text, noteMeta }); });
  if (!sent) throw new Error(`ход не отправлен: ${text}`);
  return sent;
}

/** Whole outgoing request as one string — any channel that leaks shows up here. */
function requestText(sent: Sent): string {
  return [sent.documentContent ?? '', sent.memoryContext ?? '', sent.userPortrait ?? '',
    ...sent.messages.map(m => m.content)].join('\n');
}

function mount() {
  const h = renderHook(() => useAIChat(DIALOGUE_ID, 'coach', 'standard', undefined));
  return h;
}

const QUERIES = [
  { name: 'семантический и ключевой поиск', text: 'поищи в заметках про Веру и огород' },
  { name: 'лёгкий поиск', text: 'что я писал про плитку' },
  { name: 'похожие заметки', text: 'найди похожие записи про Веру' },
  { name: 'цитаты человека', text: 'поищи, что говорит Вера' },
  { name: 'хронология', text: 'поищи в заметках за 1 октября про огород' },
  { name: 'планы и темы профиля', text: 'что я планировал по поводу огорода и плитки' },
];

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  transport._resetStreamUnavailable();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  useAiLimitStore.setState({
    remaining: 200, limit: 200, used: 0, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false,
    reasoningRemaining: 200, reasoningLimit: 200, reasoningUsed: 0,
  });
  setIndexingConsent('guest', 'granted');
  localStorage.removeItem('jw_ai_cooldown_until');
  localStorage.removeItem('jw_ai_inflight');
  vi.spyOn(transport, 'streamChat').mockImplementation(async (o) => {
    (o as unknown as { onChunk: (t: string, r: string) => void }).onChunk('ответ аудита 42', '');
    return 'ответ аудита 42';
  });
  vi.spyOn(AIService, 'embed').mockImplementation(async (arg: unknown) => {
    const t = typeof arg === 'string' ? arg : String((arg as { content?: string }).content ?? '');
    return { ok: true, vectors: [vecOf(t)], model: 'BAAI/bge-m3', dim: 24 } as never;
  });
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
  vi.spyOn(AIService, 'chat').mockResolvedValue({ ok: true, text: 'служебный ответ' } as never);
  vi.spyOn(AIProfileService, 'getPortrait').mockResolvedValue('ПОРТРЕТ-МАРКА: склонен откладывать начало.');
});

describe('аудит §4.2: скрытая и удалённая заметка не попадает в запрос', () => {
  it('каждый канал чист, если заметка скрыта до хода', async () => {
    await seed(true);
    const h = mount();
    await waitFor(() => expect(h.result.current.dialogue?.messages.length).toBe(4));
    const leaks: string[] = [];
    for (const q of QUERIES) {
      const sent = await turn(q.text, h);
      const req = requestText(sent);
      for (const bad of FORBIDDEN) {
        for (const c of carriers(req, bad)) leaks.push(`носитель «${c}» → тело ${bad} (вопрос: ${q.name})`);
      }
      if (req.includes(HID_ID)) leaks.push(`носитель «${carriers(req, HID_ID).join(' / ')}» → id скрытой (вопрос: ${q.name})`);
    }
    expect(leaks).toEqual([]);
  });

  it('каждый канал чист, если заметка скрыта между ходами того же диалога', async () => {
    await seed(false);
    const h = mount();
    await waitFor(() => expect(h.result.current.dialogue?.messages.length).toBe(4));
    const before = requestText(await turn('поищи в заметках про Веру', h));
    for (const m of FORBIDDEN) expect(before).toContain(m);

    await hideMidDialogue();

    const leaks: string[] = [];
    for (const q of QUERIES) {
      const req = requestText(await turn(q.text, h));
      for (const bad of FORBIDDEN) {
        for (const c of carriers(req, bad)) leaks.push(`носитель «${c}» → ${bad} после сокрытия (вопрос: ${q.name})`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('allowlist цитат не включает скрытые заметки, а страж вырезает ссылку на них', async () => {
    await seed(false);
    const h = mount();
    await waitFor(() => expect(h.result.current.dialogue?.messages.length).toBe(4));
    await hideMidDialogue();
    const sent = await turn('поищи в заметках про Веру', h);
    const materials = requestText(sent);
    expect(materials).not.toContain(HID_ID);
    // Модель ссылается на скрытую заметку — разрешение приходит из allowlist хода,
    // а он строится по фактически отправленным материалам (W8, AUD-M3).
    const cleaned = sanitizeCitations(
      `Ты пишешь: «Вера просила не обсуждать» [#${HID_ID} · 20261001] и вот [#${VIS_ID} · 20261001].`,
      [VIS_ID], [TITLES[VIS_ID] ?? ''], materials);
    expect(cleaned).toContain(`[#${VIS_ID}`);
    expect(cleaned).not.toContain(HID_ID);
  });
});

// W-3: отдельный прогон по блоку тем профиля. Фасеты сокрытие заметки не
// перестраивает (per ticket: никаких rebuild/incrementalUpdate из clear()),
// поэтому фильтр обязан стоять на чтении и работать на каждом ходу.
describe('W-3: темы профиля по скрытым и удалённым заметкам', () => {
  const HEADER = '[Профиль пользователя: авто-выделенные темы]';

  async function hideAll() {
    const db = await getLocalDb();
    for (const id of [VIS_ID, HID_ID, TRASH_ID]) {
      const doc = await db.get('documents', id);
      await db.put('documents', { ...doc, trashedAt: Date.now() } as never);
    }
    invalidateMiniSearchCache();
  }

  it('тема, у которой все заметки видны, приходит с обычным счётчиком', async () => {
    await seed(false);
    const h = mount();
    await waitFor(() => expect(h.result.current.dialogue?.messages.length).toBe(4));
    const text = requestText(await turn('поищи в заметках про Веру и огород', h));
    expect(text).toContain(HEADER);
    expect(text).toContain('(заметки: 3)');
  });

  it('тема с 3 заметками, из которых 2 скрыты до хода, не показывается', async () => {
    await seed(true);
    const h = mount();
    await waitFor(() => expect(h.result.current.dialogue?.messages.length).toBe(4));
    const text = requestText(await turn('поищи в заметках про Веру и огород', h));
    expect(text).not.toContain(HEADER);
    expect(text).not.toContain('Раздел "Отношения и дача"');
  });

  it('тема, все заметки которой скрыты между ходами, исчезает из следующего хода', async () => {
    await seed(false);
    const h = mount();
    await waitFor(() => expect(h.result.current.dialogue?.messages.length).toBe(4));
    expect(requestText(await turn('поищи в заметках про Веру и огород', h))).toContain(HEADER);
    await hideAll();
    expect(requestText(await turn('поищи в заметках про Веру и огород', h))).not.toContain(HEADER);
  });
});
