import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIService } from '../AIService';
import * as noteRetriever from '../../utils/noteRetriever';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    language: 'ru',
    t: (k: string) => k,
  }),
}));

describe('B-1.4 (F-013) Note selection within budget and best-last placement', () => {
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

  it('selects top-scored notes within budget instead of dropping them, placing best note last', async () => {
    const db = await getLocalDb();

    // Create 30 notes, each ~1,500 chars (total ~45,000 chars, exceeding BUDGET_CHARS 25,000)
    const notes: noteRetriever.RetrievedNote[] = [];
    const now = Date.now();

    for (let i = 0; i < 30; i++) {
      const docId = `doc_${i.toString().padStart(2, '0')}`;
      const isTop = i === 0;
      const isBottom = i === 29;
      // Note 0 has keywords "квантовый проект", high score, recent date
      // Note 29 has no keywords, low score, old date
      const textChunk = isTop
        ? 'квантовый проект '.repeat(10) + 'А'.repeat(1400)
        : 'Б'.repeat(1500);

      await db.put('documents', {
        id: docId,
        title: isTop ? 'Топ-заметка' : isBottom ? 'Худшая заметка' : `Заметка ${i}`,
        currentVersion: 1,
        lastSessionAt: isTop ? now : now - (i * 10 * 86_400_000),
      } as never);

      notes.push({
        documentId: docId,
        title: isTop ? 'Топ-заметка' : isBottom ? 'Худшая заметка' : `Заметка ${i}`,
        content: textChunk,
        score: (30 - i) * 0.01, // 0.30 down to 0.01
        lastSessionAt: isTop ? now : now - (i * 10 * 86_400_000),
      });
    }

    vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({
      notes,
      failed: false,
      degraded: false,
    });

    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: false, error: 'err' } as never);
    // Rerank fails so it relies on composite scoring
    vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'no quota' } as never);

    const { result } = renderHook(() => useAIChatContext('editor'));

    const ctx = await result.current.buildContext({
      text: 'квантовый проект',
      attached: null,
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
      forcedSearchQuery: 'квантовый проект',
    });

    expect(ctx.searchContext).toBeDefined();
    // Top-scored note (doc_00) MUST be included
    expect(ctx.injectedDocumentIds).toContain('doc_00');
    expect(ctx.searchContext).toContain('Топ-заметка');

    // Lowest-scored note (doc_29) MUST be dropped due to budget
    expect(ctx.injectedDocumentIds).not.toContain('doc_29');
    expect(ctx.searchContext).not.toContain('Худшая заметка');

    // Top note should be placed at the end of the notes block (best-last OPT-7)
    const topPos = ctx.searchContext!.indexOf('Топ-заметка');
    const midNoteId = ctx.injectedDocumentIds?.[0]; // first placed note
    const midDoc = notes.find(n => n.documentId === midNoteId);
    if (midDoc && midDoc.title !== 'Топ-заметка') {
      const midPos = ctx.searchContext!.indexOf(midDoc.title);
      expect(topPos).toBeGreaterThan(midPos);
    }
  });

  it('49,000 defensive clamp cuts from beginning of body, preserving header and best-last tail notes', async () => {
    const { useAIChat } = await import('../../hooks/useAIChat');
    const transport = await import('../../utils/aiChatTransport');

    let capturedDocumentContent: string | undefined;
    vi.spyOn(transport, 'streamChat').mockImplementation(async (params) => {
      capturedDocumentContent = params.documentContent;
      return 'OK';
    });

    const mockBuildContext = vi.fn().mockResolvedValue({
      userPortrait: null,
      customPersona: undefined,
      // 60,000 chars total: start, huge middle, important tail
      searchContext: 'BODY_START ' + 'A'.repeat(55_000) + ' IMPORTANT_TAIL_BEST_NOTE',
      memoryContext: null,
      injectedDocumentIds: [],
      allowedFirstSeenDates: [],
      degradedReason: null,
    });

    // Provide mock via spy or hook
    const { renderHook: renderHookAIChat, act } = await import('@testing-library/react');
    const aiChatContextModule = await import('../aiChatContext');
    vi.spyOn(aiChatContextModule, 'useAIChatContext').mockReturnValue({
      buildContext: mockBuildContext,
      getAttachedNote: vi.fn().mockReturnValue(null),
      setAttachedNote: vi.fn(),
      getMessageCount: vi.fn().mockReturnValue(1),
      incrementMessageCount: vi.fn(),
      resetSession: vi.fn(),
    });

    const { result } = renderHookAIChat(() => useAIChat(null, 'editor'));

    await act(async () => {
      await result.current.sendMessage('Тест');
    });

    expect(capturedDocumentContent).toBeDefined();
    expect(capturedDocumentContent!.length).toBeLessThanOrEqual(49_000);
    // Preserves [Сегодня: ...] header
    expect(capturedDocumentContent!).toContain('[Сегодня:');
    // Preserves the tail (where the best notes are)
    expect(capturedDocumentContent!).toContain('IMPORTANT_TAIL_BEST_NOTE');
  });
});

