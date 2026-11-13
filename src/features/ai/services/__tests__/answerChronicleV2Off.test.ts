// Флаг answer_chronicle_v2 выключен → ход идёт байт в байт как в pack-0-11-10.
//
// Эталоны `__golden__/answer-chronicle-off*.pack-0-11-10.txt` записаны ЭТИМ ЖЕ тестом
// на дереве pack-0-11-10 (f78b2f77, `git archive` + этот файл), а не на ветке:
// контекст хода, память, разрешённые даты и системный промпт целиком. Обновлять
// его на ветке нельзя — тогда тест перестаёт сравнивать с 0.11.10.
//
// Мутации, на которых тест краснеет:
//  - `answerChronicleV2Enabled` возвращает true при сбое чтения (fallback true)
//    → красные «сбой RPC» и «сеть упала»;
//  - убрать `if (!uid) return false` и вернуть true → красный «гость»;
//  - `v2` в buildTopicChronicle по умолчанию true → красные все четыре;
//  - добавить ARCHIVE_ANSWER_RULE в промпт без проверки метки → красные все четыре.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';

const rpc = vi.fn();
let uid: string | undefined = 'u1';
// Прочие обращения к серверу при uid (портрет и т. п.) отвечают «пусто»: цепочка
// любых методов, в конце — { data: null, error: null }.
const emptyChain: unknown = new Proxy(() => undefined, {
  get: (_t, prop) => (prop === 'then'
    ? (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
    : () => emptyChain),
});
vi.mock('../../../../core/supabase/client', () => ({ getSupabase: () => ({ rpc, from: () => emptyChain }) }));
vi.mock('../../../../core/auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getCurrentUser: () => (uid ? { uid } : null),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { useAIChatContext } from '../aiChatContext';
import { AIService } from '../AIService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { buildChatSystemPrompt } from '../../../../shared/ai/buildChatPrompt';
import * as syncFlags from '../../../../core/sync/syncFlags';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
const vec = (c: number): number[] => [c, Math.sqrt(Math.max(0, 1 - c * c)), 0];
const QUESTION = 'когда я впервые начала думать о смене работы?';

// Длинная заметка из трёх кусков: вторая версия подачи дала бы ей второй кусок.
const ROWS = [
  { id: 'local_far', iso: '2025-01-05', chunks: [['Про погоду.', 0.1]] },
  { id: 'local_early', iso: '2025-07-03', chunks: [['Сегодня подумала, что могла бы сменить работу.', 0.55]] },
  { id: 'local_long', iso: '2026-03-10', chunks: [
    ['Начало длинной записи: утро, кофе, дорога.', 0.42],
    ['Середина: разговор с начальником о смене работы и о сроках.', 0.7],
    ['Конец: решила вернуться к этому в мае, записала сумму 120 000.', 0.6],
  ] },
  { id: 'local_late', iso: '2026-09-01', chunks: [['Опять думаю про смену работы, уже всерьёз.', 0.8]] },
] as const;

async function turn(): Promise<string> {
  const { result } = renderHook(() => useAIChatContext('coach'));
  const ctx = await result.current.buildContext({
    text: QUESTION,
    attached: null,
    mood: undefined,
    messageHistory: [
      { role: 'user', content: 'помоги составить план на неделю' },
      { role: 'assistant', content: 'Давай.' },
      { role: 'user', content: QUESTION },
    ] as never,
    isFirstTurn: false,
  });
  const prompt = buildChatSystemPrompt({
    personaId: 'coach',
    responseLength: 'detailed',
    documentContent: ctx.searchContext,
    memoryContext: ctx.memoryContext,
    userPortrait: ctx.userPortrait,
    lastUserMessage: QUESTION,
    rnd: () => 0,
  });
  return [
    '=== searchContext ===', ctx.searchContext ?? '',
    '=== memoryContext ===', ctx.memoryContext ?? '',
    '=== allowedFirstSeenDates ===', (ctx.allowedFirstSeenDates ?? []).join(','),
    '=== injectedDocumentIds ===', (ctx.injectedDocumentIds ?? []).join(','),
    '=== system prompt ===', prompt,
  ].join('\n');
}

const GOLDEN = './__golden__/answer-chronicle-off.pack-0-11-10.txt';
const GOLDEN_GUEST = './__golden__/answer-chronicle-off-guest.pack-0-11-10.txt';

describe('answer_chronicle_v2 выключен: ход побайтно как в pack-0-11-10', () => {
  beforeEach(async () => {
    rpc.mockReset();
    uid = 'u1';
    // На дереве pack-0-11-10 этого сброса нет — там флаг и не читается.
    (syncFlags as { resetSyncFlagsForTests?: () => void }).resetSyncFlagsForTests?.();
    setIndexingConsent('u1', 'granted');
    setIndexingConsent(undefined, 'granted');
    const db = await getLocalDb();
    for (const s of ['documents', 'aiEmbeddings'] as const) await db.clear(s);
    for (const r of ROWS) {
      await db.put('documents', { id: r.id, guestId: 'guest', title: `Заметка ${r.id}`, currentVersion: 1, totalWords: 9, totalDuration: 0, sessionsCount: 1, firstSessionAt: day(r.iso), lastSessionAt: day(r.iso), tags: [] } as never);
      await markAllAnalysed(db);
    }
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(ROWS.map(r => ({
      documentId: r.id, vectors: r.chunks.map(c => vec(c[1])), chunkTexts: r.chunks.map(c => c[0]), contentHash: r.id, processedAt: 1, model: 'm', dim: 3,
    })) as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]], chunks: ['q'], model: 'm', dim: 3 } as never);
  });

  it('сервер сказал «нет» (или строки флага нет)', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(await turn()).toMatchFileSnapshot(GOLDEN);
  });

  it('сбой RPC (сервер без функции) — старый путь, не «включено»', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    await expect(await turn()).toMatchFileSnapshot(GOLDEN);
  });

  it('сеть упала — старый путь', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(await turn()).toMatchFileSnapshot(GOLDEN);
  });

  it('гость (нет uid) — старый путь, сервер не спрашивается', async () => {
    uid = undefined;
    rpc.mockResolvedValue({ data: true, error: null });
    // У гостя ход и в 0.11.10 собирается иначе, чем у вошедшего, — свой эталон.
    await expect(await turn()).toMatchFileSnapshot(GOLDEN_GUEST);
    expect(rpc).not.toHaveBeenCalledWith('feature_enabled', { flag: 'answer_chronicle_v2' });
  });
});
