import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb, type AIDialogue } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    language: 'ru',
    t: (k: string) => k,
  }),
}));
vi.mock('../../services/aiChatContext', () => ({
  useAIChatContext: () => ({
    buildContext: vi.fn().mockResolvedValue({
      userPortrait: null,
      customPersona: undefined,
      searchContext: '',
      memoryContext: null,
      injectedDocumentIds: [],
      allowedFirstSeenDates: [],
      degradedReason: null,
    }),
    getAttachedNote: vi.fn().mockReturnValue(null),
    setAttachedNote: vi.fn(),
    getMessageCount: vi.fn().mockReturnValue(1),
    incrementMessageCount: vi.fn(),
    resetSession: vi.fn(),
  }),
}));

describe('B-1.3 (F-030): stopped answer is saved with not-finished marker', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    transport._resetStreamUnavailable();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
    useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100000), loaded: true, isAdmin: false });
    const db = await getLocalDb();
    const all = await db.getAll('aiDialogues');
    for (const rec of all) await db.delete('aiDialogues', rec.id);
  });

  it('stop mid-stream -> stored assistant message ends with the marker', async () => {
    const db = await getLocalDb();
    const dialogueId = 'diag-stop-1';
    const initialDialogue: AIDialogue = {
      id: dialogueId,
      title: 'Тест диалог',
      personaId: 'editor',
      personaName: 'Редактор',
      personaEmoji: '✍️',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [],
    };
    await db.put('aiDialogues', initialDialogue);

    const { result } = renderHook(() => useAIChat(dialogueId, 'editor'));

    await waitFor(() => {
      expect(result.current.dialogue?.messages).toBeDefined();
    });

    vi.spyOn(transport, 'streamChat').mockImplementation(async (opts) => {
      opts.onChunk('Начало ответа', '');
      result.current.stop();
      // As in aiChatTransport.ts:329, aborted stream returns partial text
      return 'Начало ответа';
    });

    await act(async () => {
      await result.current.sendMessage('Вопрос');
    });

    const stored = await db.get('aiDialogues', dialogueId);
    expect(stored?.messages).toHaveLength(2);
    expect(stored?.messages[0]?.content).toBe('Вопрос');
    expect(stored?.messages[1]?.role).toBe('assistant');
    expect(stored?.messages[1]?.content).toContain('[ответ не дописан — стрим оборвался]');
    expect(stored?.messages[1]?.content?.endsWith('[ответ не дописан — стрим оборвался]')).toBe(true);
  });
});
