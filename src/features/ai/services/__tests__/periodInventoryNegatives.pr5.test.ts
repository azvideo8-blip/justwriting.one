// PA-3/PA-5 (тикет 26.10): «мне всё равно, что было» и «все говорят» не должны
// включать перечень. Слово «все» есть в LIST_WORDS, «что было» — в FACTS_ASK_RE,
// поэтому правило держится только на одном требовании: перечень собирается внутри
// хода периода. Отдельно проверяется тот же оборот как продолжение после
// октябрьского перечня: «все говорят» — не продолжение периода, окно не тянется.
//
// Мутация: вынести inventoryBlock из ветки периода (звать при LIST_REQUEST без
// окна) → (1) и (2) красные; расширить PERIOD_CONTINUATION_RE на «говорят» →
// (3) красный.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIService } from '../../services/AIService';
import * as noteRetriever from '../../utils/noteRetriever';
import { buildTemporalBlocks } from '../chatContext/temporalBlocks';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

const INVENTORY = '[Все записи периода';
const CARRIED = '[Записи периода, о котором шла речь]';
const DAY = 86_400_000;
const OCT_1 = Date.UTC(2026, 9, 1);

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings', 'versions'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  await db.put('documents', {
    id: 'local_pr5n_a', guestId: 'u1', title: 'Октябрь две', currentVersion: 1,
    totalWords: 30, totalDuration: 60, sessionsCount: 1,
    firstSessionAt: OCT_1 + DAY, lastSessionAt: OCT_1 + DAY, tags: [],
  } as never);
  await db.put('aiSummaries', {
    documentId: 'local_pr5n_a', processedAt: OCT_1, summary: 'СУТЬ_А', themes: [],
    insights: ['ОЗАРЕНИЕ_А'], extractedFacts: ['ФАКТ_А'],
  } as never);
  vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue('Тело записи');
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]] } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
  vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({ notes: [], failed: false, degraded: false } as never);
}

async function block(text: string): Promise<string> {
  const res = await buildTemporalBlocks({
    text, effectiveQuery: text, explicitSearch: false, lastSearchQuery: '', db: await getLocalDb(),
  });
  return res.appended;
}

type History = { role: 'user' | 'assistant'; content: string }[];

async function ask(build: (p: Record<string, unknown>) => Promise<{ searchContext: string }>, params: {
  text: string; messageHistory: History;
}): Promise<string> {
  const ctx = await build({
    text: params.text, attached: undefined, mood: undefined,
    messageHistory: params.messageHistory, isFirstTurn: false, scope: 'wide',
  });
  return ctx.searchContext ?? '';
}

describe('PA-5: формы «все» и «что было» вне окна периода перечень не включают', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('«мне всё равно, что было» — перечня нет', async () => {
    await seed();
    const text = await block('мне всё равно, что было');
    expect(text).not.toContain(INVENTORY);
  });

  it('«все говорят разное» — перечня нет', async () => {
    await seed();
    const text = await block('все говорят разное');
    expect(text).not.toContain(INVENTORY);
  });

  it('то же как продолжение после октябрьского перечня — окно не тянется', async () => {
    await seed();
    const build = renderHook(() => useAIChatContext('coach')).result.current.buildContext as never;
    const first = 'перечисли все мои осознания за октябрь 2026';
    const h: History = [{ role: 'user', content: first }];
    await ask(build, { text: first, messageHistory: h });

    for (const cont of ['все говорят разное', 'мне всё равно, что было']) {
      const text = await ask(build, {
        text: cont,
        messageHistory: [...h, { role: 'assistant', content: 'Вот записи октября.' }, { role: 'user', content: cont }],
      });
      expect(text, cont).not.toContain(CARRIED);
      expect(text, cont).not.toContain('ОЗАРЕНИЕ_А');
    }
  });

  it('контроль: просьба «перечисли» с периодом перечень даёт', async () => {
    await seed();
    const text = await block('перечисли все мои осознания за октябрь 2026');
    expect(text).toContain(INVENTORY);
    expect(text).toContain('ОЗАРЕНИЕ_А');
  });
});
