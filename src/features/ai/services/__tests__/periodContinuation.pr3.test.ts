// PR-3 (16.3): «перечитай по одной» после хода-перечня терял период: окно
// бралось только из текущей реплики, а в ней периода нет. Прошлый ход периода
// с перечнем запоминается детерминированно (окно из разбора реплики, не из
// ответа модели), и продолжение поднимает записи того же окна.
//
// Мутация: не передавать carriedWindow в buildTemporalBlocks → (1) красный;
// тянуть окно после обычного хода без перечня → (3) красный.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIService } from '../../services/AIService';
import * as noteRetriever from '../../utils/noteRetriever';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

const DAY = 86_400_000;
const OCT_1 = Date.UTC(2026, 9, 1);

const NOTES = [
  { id: 'local_pr3_a', day: 2, insight: 'ОЗАРЕНИЕ_ПЕРИОДА_А', summary: 'СУТЬ_ПЕРИОДА_А' },
  { id: 'local_pr3_b', day: 11, insight: 'ОЗАРЕНИЕ_ПЕРИОДА_Б', summary: 'СУТЬ_ПЕРИОДА_Б' },
  { id: 'local_pr3_hidden', day: 5, insight: 'СКРЫТОЕ_ОЗАРЕНИЕ', summary: 'СКРЫТАЯ_СУТЬ', excludedFromAI: true },
];

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings', 'versions'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  for (const n of NOTES) {
    const at = OCT_1 + (n.day - 1) * DAY;
    await db.put('documents', {
      id: n.id, guestId: 'u1', title: `Октябрь ${n.day}`, currentVersion: 1,
      totalWords: 30, totalDuration: 60, sessionsCount: 1,
      firstSessionAt: at, lastSessionAt: at, tags: [],
      ...(n.excludedFromAI ? { excludedFromAI: true } : {}),
    } as never);
    await db.put('aiSummaries', {
      documentId: n.id, processedAt: OCT_1, summary: n.summary, themes: [],
      insights: [n.insight], extractedFacts: [`ФАКТ_${n.id}`],
    } as never);
  }
  vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue('Тело записи');
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]] } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
  vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({ notes: [], failed: false, degraded: false } as never);
}

type History = { role: 'user' | 'assistant'; content: string }[];

async function ask(
  build: (params: Record<string, unknown>) => Promise<{ searchContext: string }>,
  text: string,
  history: History,
): Promise<string> {
  const ctx = await build({
    text,
    attached: undefined,
    mood: undefined,
    messageHistory: history,
    isFirstTurn: false,
    scope: 'wide',
  });
  return ctx.searchContext ?? '';
}

describe('PR-3: продолжение держит окно периода', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('«перечитай по одной» после перечня поднимает записи того же окна', async () => {
    await seed();
    const { result } = renderHook(() => useAIChatContext('coach'));
    const build = result.current.buildContext as never;

    const first = 'перечисли все мои осознания за октябрь 2026';
    const h1: History = [{ role: 'user', content: first }];
    await ask(build, first, h1);

    const cont = 'перечитай по одной';
    const h2: History = [...h1, { role: 'assistant', content: 'Вот записи октября.' }, { role: 'user', content: cont }];
    const block = await ask(build, cont, h2);

    expect(block).toContain('[Записи периода, о котором шла речь]');
    expect(block).toContain('ОЗАРЕНИЕ_ПЕРИОДА_А');
    expect(block).toContain('ОЗАРЕНИЕ_ПЕРИОДА_Б');
    expect(block).toContain('local_pr3_a');
    expect(block).not.toContain('СКРЫТОЕ_ОЗАРЕНИЕ');
  });

  it('новая тема без слов продолжения окно не тянет', async () => {
    await seed();
    const { result } = renderHook(() => useAIChatContext('coach'));
    const build = result.current.buildContext as never;

    const first = 'перечисли все мои осознания за октябрь 2026';
    const h1: History = [{ role: 'user', content: first }];
    await ask(build, first, h1);

    const other = 'расскажи про сопротивление';
    const h2: History = [...h1, { role: 'assistant', content: 'Вот записи октября.' }, { role: 'user', content: other }];
    const block = await ask(build, other, h2);
    expect(block).not.toContain('[Записи периода, о котором шла речь]');
  });

  it('после хода периода без перечня продолжение окно не тянет', async () => {
    await seed();
    const { result } = renderHook(() => useAIChatContext('coach'));
    const build = result.current.buildContext as never;

    const first = 'что было в октябре 2026';
    const h1: History = [{ role: 'user', content: first }];
    await ask(build, first, h1);

    const cont = 'перечитай по одной';
    const h2: History = [...h1, { role: 'assistant', content: 'Вот что было.' }, { role: 'user', content: cont }];
    const block = await ask(build, cont, h2);
    expect(block).not.toContain('[Записи периода, о котором шла речь]');
  });
});
