import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    language: 'ru',
    t: (k: string) => k,
  }),
}));

describe('B-1.5 (F-012) Period-comparison mode preserves attached note', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const db = await getLocalDb();
    for (const store of ['documents', 'aiSummaries', 'aiEmbeddings'] as const) {
      const all = await db.getAll(store);
      for (const rec of all) {
        await db.delete(store, (rec as { id: string; documentId?: string }).id || (rec as { documentId: string }).documentId);
      }
    }
  });

  it('preserves attached note text when period comparison mode is triggered', async () => {
    const db = await getLocalDb();
    const ATTACHED_ID = 'doc_attached_123';
    const ATTACHED_CONTENT = 'Уникальный текст прикреплённой пользователем заметки для анализа';

    await db.put('documents', {
      id: ATTACHED_ID,
      title: 'Моя прикреплённая заметка',
      currentVersion: 1,
      lastSessionAt: Date.now(),
    } as never);

    const { result } = renderHook(() => useAIChatContext('editor'));

    const ctx = await result.current.buildContext({
      text: 'сравни январь и февраль',
      attached: {
        documentId: ATTACHED_ID,
        content: ATTACHED_CONTENT,
      },
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
    });

    expect(ctx.searchContext).toBeDefined();
    // Context must contain period comparison block
    expect(ctx.searchContext).toContain('РЕЖИМ СРАВНЕНИЯ ПЕРИОДОВ');
    // Context must ALSO preserve the attached note content
    expect(ctx.searchContext).toContain(ATTACHED_CONTENT);
    // Injected documents must list the attached document
    expect(ctx.injectedDocumentIds).toContain(ATTACHED_ID);
  });
});
