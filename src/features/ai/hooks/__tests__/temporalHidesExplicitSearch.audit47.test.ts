// Аудит 0.9.34, §4.7 (живой прогон): просьба поискать по архиву, в которой есть
// слова «что у меня», не ищет в архиве вовсе.
//
// Живой ход «поищи в заметках, что у меня было с Олей» (кейс A1m, три персоны,
// три повтора) ушёл провайдеру без единой заметки: в фенсе лежал только блок
// цитат человека. Модель на этом ответила выдуманной ссылкой и выдуманным
// содержанием заметки — пример в отчёте.
//
// Цепочка: temporalQueryParser.ts:252 ловит «что у меня» как тип `recent` →
// aiChatContext.ts:490 по `skipSemantic` не запускает поиск вообще → :712 по
// `handledByTemporal` не пишет и фразу «по этому запросу ничего не нашлось» →
// :736 лёгкий поиск тоже мимо, потому что `explicitSearch` истинен. Итог: ход,
// который человек явно просил искать, уходит без архива и без объяснения.
//
// Мутация, на которой тест зелёный: в shouldRunFullSearch/turnScope этот ход
// считается поиском (так и есть), а в buildTemporalBlocks `recent` не ставит
// skipSemantic при явном поиске — достаточно одного из.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import 'fake-indexeddb/auto';

import { useAIChat } from '../useAIChat';
import { getLocalDb } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { AIService } from '../../services/AIService';
import * as noteRetriever from '../../utils/noteRetriever';
import { invalidateMiniSearchCache } from '../../utils/retrieval/indexCache';
import { invalidateEmbeddingIndexCache } from '../../../../core/services/embeddingIndexCache';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { parseTemporalQuery } from '../../utils/temporalQueryParser';
import { shouldRunFullSearch } from '../../utils/aiChatTransport';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ language: 'ru', t: (k: string) => k }),
}));

const DIALOGUE_ID = 'd_audit47_temporal';
const TURN = 'поищи в заметках, что у меня было с Олей';

// Синтетика: выдуманные имена и тексты, никаких живых записей.
const NOTES: Array<[string, string, string]> = [
  ['local_47_n1', 'Ссора с Олей', 'ТЕКСТ-ССОРА: Оля написала, что я ставлю ей в счёт каждую встречу, и я не нашлась что ответить.'],
  ['local_47_n2', 'Мир с Олей', 'ТЕКСТ-МИР: Оля предложила бежать в субботу, и мы договорились не вспоминать про счёт.'],
  ['local_47_n3', 'План на неделю', 'ТЕКСТ-ПЛАН: три блока работы, одна пробежка, вечер с книгой.'],
];

function vecOf(text: string): number[] {
  const v = new Array(24).fill(0);
  for (const ch of text) v[(ch.codePointAt(0) ?? 0) % 24] += 1;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map(x => x / n);
}

async function seed(notes: Array<[string, string, string]> = NOTES) {
  const db = await getLocalDb();
  for (const store of ['documents', 'versions', 'aiDialogues', 'aiEmbeddings', 'aiSummaries'] as const) {
    await db.clear(store);
  }
  const base = Date.UTC(2026, 8, 20, 8, 0);
  for (const [id, title, body] of notes) {
    await db.put('documents', {
      id, guestId: 'guest', title, currentVersion: 1, totalWords: 30, totalDuration: 200,
      sessionsCount: 1, firstSessionAt: base, lastSessionAt: base, tags: [],
    } as never);
    await db.put('versions', {
      id: `v_${id}`, documentId: id, guestId: 'guest', version: 1, content: body,
      wordCount: 30, wordsAdded: 30, charsAdded: body.length, duration: 200, wpm: 20, createdAt: base,
    } as never);
    await db.put('aiEmbeddings', {
      documentId: id, vectors: [vecOf(body)], chunkTexts: [body],
      model: 'BAAI/bge-m3', dim: 24, contentHash: '', processedAt: base, schemaV: 3, cloudSyncedAt: base,
    } as never);
  }
  await db.put('aiDialogues', {
    id: DIALOGUE_ID, title: 'Аудит 47', personaId: 'coach', personaName: 'Коуч',
    personaEmoji: '🎯', createdAt: base, updatedAt: base, messages: [],
  } as never);
}

interface TurnResult {
  doc: string;
  searchCalls: Array<{ queries: string[]; minTime?: number | undefined; maxTime?: number | undefined }>;
}

async function sendTurn(turn = TURN, notes: Array<[string, string, string]> = NOTES): Promise<TurnResult> {
  localStorage.removeItem('jw_ai_cooldown_until');
  localStorage.removeItem('jw_ai_inflight');
  await seed(notes);
  const searchCalls: TurnResult['searchCalls'] = [];
  const realSearch = noteRetriever.searchNotesMulti;
  vi.spyOn(noteRetriever, 'searchNotesMulti').mockImplementation(async (queries, topK, opts) => {
    searchCalls.push({
      queries: [...queries],
      minTime: (opts as { minTime?: number } | undefined)?.minTime,
      maxTime: (opts as { maxTime?: number } | undefined)?.maxTime,
    });
    return realSearch(queries, topK, opts);
  });
  const sent: Array<{ documentContent?: string }> = [];
  vi.spyOn(transport, 'streamChat').mockImplementation(async o => {
    sent.push(o as { documentContent?: string });
    o.onChunk('фиктивный ответ аудита 47', '');
    return 'фиктивный ответ аудита 47';
  });
  vi.spyOn(AIService, 'embed').mockImplementation(async (arg: unknown) => {
    const texts = typeof arg === 'string' ? [arg] : [String((arg as { content?: string }).content ?? '')];
    return { ok: true, vectors: texts.map(vecOf), model: 'BAAI/bge-m3', dim: 24 } as never;
  });
  const { result } = renderHook(() => useAIChat(DIALOGUE_ID, 'coach', 'standard'));
  await waitFor(() => expect(result.current.dialogue?.messages.length).toBe(0));
  await act(async () => { await result.current.sendMessage(turn); });
  const last = sent[sent.length - 1];
  if (!last) throw new Error(`ход не ушёл: ${String((result.current as { error?: string | null }).error ?? '')}`);
  return { doc: last.documentContent ?? '', searchCalls };
}

describe('аудит §4.7: явный поиск не должен гаснуть из-за хронологии', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    transport._resetStreamUnavailable();
    invalidateMiniSearchCache();
    invalidateEmbeddingIndexCache();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
    useAiLimitStore.setState({
      remaining: 200, limit: 200, used: 0, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false,
      reasoningRemaining: 200, reasoningLimit: 200, reasoningUsed: 0,
    });
    setIndexingConsent('guest', 'granted');
  });

  it('ход помечается и как хронологический, и как явный поиск — это и есть стык', () => {
    expect(parseTemporalQuery(TURN).type).toBe('recent');
    expect(shouldRunFullSearch(TURN, false)).toBe(true);
  });

  it('просьба поискать по архиву приносит заметки в запрос', async () => {
    const { doc } = await sendTurn();
    expect(doc).toContain('Результаты поиска по архиву');
    expect(doc).toContain('Ссора с Олей');
    expect(doc).toContain('ТЕКСТ-МИР');
  });

  // W-1 (а): «что у меня» без глагола поиска — прежний догоняющий ход: сводка
  // есть, архив не поднимается.
  it('«что у меня с работой» без просьбы искать остаётся догоняющим ходом', async () => {
    const { doc, searchCalls } = await sendTurn('что у меня с работой');
    expect(doc).toContain('[Хронологическая сводка]');
    expect(doc).not.toContain('Результаты поиска по архиву');
    expect(searchCalls.some(c => c.queries.some(q => q.includes('что у меня с работой')))).toBe(false);
  });

  // W-1 (b): явный поиск по пустому архиву обязан сказать «не нашлось», даже
  // когда ход разобран как хронологический.
  it('явный поиск по пустому архиву пишет «не нашёл подходящих заметок»', async () => {
    const { doc } = await sendTurn('поищи в заметках, что у меня было про акварель', []);
    expect(doc).toContain('[Хронологическая сводка]');
    expect(doc).toContain('не нашёл подходящих заметок');
  });

  // W-1 (c): dateRange-путь не меняется — окно по-прежнему ограничивает поиск.
  it('«что было на прошлой неделе» идёт прежним путём окна дат', async () => {
    const { doc, searchCalls } = await sendTurn('что было на прошлой неделе');
    expect(doc).toContain('[Результаты поиска по хронологии]');
    const windowed = searchCalls.filter(c => typeof c.minTime === 'number' && typeof c.maxTime === 'number');
    expect(windowed.length).toBeGreaterThan(0);
    expect(windowed.every(c => (c.maxTime as number) > (c.minTime as number))).toBe(true);
  });
});
