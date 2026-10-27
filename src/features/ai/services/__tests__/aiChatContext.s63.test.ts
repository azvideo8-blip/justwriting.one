import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { reportError } from '../../../../shared/errors/reportError';
import { linkedNote } from '../../../../test/attachedTurnFixtures';

// S-51 survivor (S-63) в buildContext: сбой чтения приложенной заметки читается
// как «скрыта» (catch в ветке attached), тело и id до модели не доезжают.
// Второй случай S-56 (отказ реранжирования по согласию) убран вместе с самим
// вторым проходом реранка в чате — П-1, регрессия в singleRerankPass.p1.test.ts.

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

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
      attached: linkedNote('local_boom', SECRET),
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
    });

    expect(ctx.searchContext ?? '').not.toContain('Секретный текст');
    expect(ctx.injectedDocumentIds).not.toContain('local_boom');
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'IDB down' }), expect.objectContaining({ action: 'hideExcludedNotes', documentId: 'local_boom' }));
  });
});
