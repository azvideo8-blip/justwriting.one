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

describe('B-1.1 (F-011): regenerate does not duplicate question in storage or prompt', () => {
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

  it('regenerate -> stored messages equal [..., Q, A_new] with variants [A_old, A_new], transport received history without A_old', async () => {
    const db = await getLocalDb();
    const dialogueId = 'diag-regen-1';
    const initialDialogue: AIDialogue = {
      id: dialogueId,
      title: 'Тест диалог',
      personaId: 'editor',
      personaName: 'Редактор',
      personaEmoji: '✍️',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [
        { role: 'user', content: 'Вопрос один' },
        { role: 'assistant', content: 'Ответ один' },
      ],
    };
    await db.put('aiDialogues', initialDialogue);

    let sentApiMessages: any[] = [];
    vi.spyOn(transport, 'streamChat').mockImplementation(async (opts) => {
      sentApiMessages = opts.messages;
      opts.onChunk('Ответ два', '');
      return 'Ответ два';
    });

    const { result } = renderHook(() => useAIChat(dialogueId, 'editor'));

    await waitFor(() => {
      expect(result.current.dialogue?.messages.length).toBe(2);
    });

    await act(async () => {
      await result.current.regenerateLast();
    });

    // 1. Transport received history WITHOUT A_old
    // The messages sent to API should only be: [{ role: 'user', content: 'Вопрос один' }]
    expect(sentApiMessages).toHaveLength(1);
    expect(sentApiMessages[0]?.role).toBe('user');
    expect(sentApiMessages[0]?.content).toBe('Вопрос один');

    // 2. Storage has exactly 2 messages: [Q, A_new]
    const stored = await db.get('aiDialogues', dialogueId);
    expect(stored?.messages).toHaveLength(2);
    expect(stored?.messages[0]?.role).toBe('user');
    expect(stored?.messages[0]?.content).toBe('Вопрос один');
    expect(stored?.messages[1]?.role).toBe('assistant');
    expect(stored?.messages[1]?.content).toBe('Ответ два');
    expect(stored?.messages[1]?.variants).toEqual(['Ответ один', 'Ответ два']);
    expect(stored?.messages[1]?.variantIndex).toBe(1);
  });

  it('transport fails -> stored dialogue unchanged', async () => {
    const db = await getLocalDb();
    const dialogueId = 'diag-regen-2';
    const initialDialogue: AIDialogue = {
      id: dialogueId,
      title: 'Тест диалог',
      personaId: 'editor',
      personaName: 'Редактор',
      personaEmoji: '✍️',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [
        { role: 'user', content: 'Вопрос один' },
        { role: 'assistant', content: 'Ответ один' },
      ],
    };
    await db.put('aiDialogues', initialDialogue);

    vi.spyOn(transport, 'streamChat').mockRejectedValue(new Error('NETWORK_ERROR'));
    vi.spyOn(transport, 'callableChat').mockRejectedValue(new Error('NETWORK_ERROR'));

    const { result } = renderHook(() => useAIChat(dialogueId, 'editor'));

    await waitFor(() => {
      expect(result.current.dialogue?.messages.length).toBe(2);
    });

    await act(async () => {
      await result.current.regenerateLast();
    });

    // Storage is untouched
    const stored = await db.get('aiDialogues', dialogueId);
    expect(stored?.messages).toHaveLength(2);
    expect(stored?.messages[0]?.content).toBe('Вопрос один');
    expect(stored?.messages[1]?.content).toBe('Ответ один');
  });
});
