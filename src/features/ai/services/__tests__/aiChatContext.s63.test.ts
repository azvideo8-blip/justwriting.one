import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIService } from '../AIService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { reportError } from '../../../../shared/errors/reportError';
import { reportAIDegradation } from '../../utils/aiDegradationReporter';

// S-51 / S-56 survivors (S-63) в buildContext: сбой чтения приложенной заметки
// читается как «скрыта» (catch, aiChatContext.ts:231); отказ реранжирования по
// согласию — не запись о деградации (:532).

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../utils/aiDegradationReporter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/aiDegradationReporter')>();
  return { ...actual, reportAIDegradation: vi.fn() };
});

const SECRET = 'Секретный текст заметки, который не должен уйти.';

describe('S-63: buildContext survivors', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false });
    const db = await getLocalDb();
    for (const store of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings'] as const) {
      const all = await db.getAll(store);
      for (const rec of all) await db.delete(store, (rec as { id: string; documentId?: string }).id || (rec as { documentId: string }).documentId);
    }
  });

  it('S-51: a failed read of the attached note counts as hidden — the body does not reach the model, the failure is reported', async () => {
    const db = await getLocalDb();
    const orig = db.get.bind(db);
    vi.spyOn(db, 'get').mockImplementation((async (store: string, id: string) => {
      if (store === 'documents' && id === 'local_boom') throw new Error('IDB down');
      return orig(store as never, id as never);
    }) as never);

    const { result } = renderHook(() => useAIChatContext('editor'));
    const ctx = await result.current.buildContext({
      text: 'Что скажешь?',
      attached: { documentId: 'local_boom', content: SECRET },
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
    });

    expect(ctx.searchContext ?? '').not.toContain('Секретный текст');
    expect(ctx.injectedDocumentIds).not.toContain('local_boom');
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'IDB down' }), expect.objectContaining({ action: 'buildContext_attachedExcluded' }), 'warning');
  });

  it('S-56: a rerank refused for consent is not a degradation record; a real rerank failure is', async () => {
    const db = await getLocalDb();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map(x => `local_${x}`);
    for (const id of ids) {
      await db.put('documents', { id, guestId: 'u1', title: `Заметка ${id}`, currentVersion: 1, totalWords: 50, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: [] } as never);
    }
    vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue('Текст про проект Альфа и всё вокруг него.');
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(ids.map(id => ({
      documentId: id, vectors: [[1, 0, 0]], chunkTexts: ['Текст про проект Альфа'], contentHash: 'h', processedAt: 1, model: 'm', dim: 3,
    })) as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]] } as never);
    const rerank = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'INDEXING_CONSENT_REQUIRED' } as never);

    const { result } = renderHook(() => useAIChatContext('editor'));
    const run = () => result.current.buildContext({
      text: 'Что там было в заметках про Альфа?', attached: null, mood: undefined, messageHistory: [], isFirstTurn: true, forcedSearchQuery: 'Альфа',
    });

    await run();
    expect(rerank, 'реранжирование не вызвано — тест ничего не проверяет').toHaveBeenCalled();
    expect(vi.mocked(reportAIDegradation).mock.calls.filter(c => c[0].feature === 'chat_rerank')).toEqual([]);

    rerank.mockResolvedValue({ ok: false, error: 'UPSTREAM' } as never);
    await run();
    expect(vi.mocked(reportAIDegradation).mock.calls.filter(c => c[0].feature === 'chat_rerank')).toHaveLength(1);
  });
});
