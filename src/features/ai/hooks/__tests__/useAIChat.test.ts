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

describe('useAIChat tests (AG-ERR-2 & AG-CHAT-2)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    transport._resetStreamUnavailable();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
    useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100000), loaded: true, isAdmin: false });
    const db = await getLocalDb();
    for (const store of ['documents', 'versions', 'aiDialogues', 'aiSummaries', 'aiEmbeddings'] as const) {
      const all = await db.getAll(store);
      for (const rec of all) await db.delete(store, (rec as { id: string }).id || (rec as { documentId: string }).documentId);
    }
  });

  describe('AG-ERR-2: AI error codes & RATE_LIMIT handling', () => {
    it('shows cooldown error message when RATE_LIMIT is thrown and does not fallback to callableChat', async () => {
      const streamSpy = vi.spyOn(transport, 'streamChat').mockRejectedValue(new Error('RATE_LIMIT'));
      const callableSpy = vi.spyOn(transport, 'callableChat').mockResolvedValue('Fallback answer');

      const { result } = renderHook(() => useAIChat(null, 'editor'));

      let sendResult: string | null = null;
      await act(async () => {
        sendResult = await result.current.sendMessage('Привет');
      });

      expect(sendResult).toBeNull();
      expect(streamSpy).toHaveBeenCalled();
      expect(callableSpy).not.toHaveBeenCalled();
      expect(result.current.error).toBe('Слишком частые запросы. Подождите немного перед следующей отправкой.');
    });

    it('shows upstream error message when UPSTREAM is thrown and does not fallback to callableChat (F-06)', async () => {
      const streamSpy = vi.spyOn(transport, 'streamChat').mockRejectedValue(new Error('UPSTREAM'));
      const callableSpy = vi.spyOn(transport, 'callableChat').mockResolvedValue('Fallback answer');

      const { result } = renderHook(() => useAIChat(null, 'editor'));

      let sendResult: string | null = null;
      await act(async () => {
        sendResult = await result.current.sendMessage('Привет');
      });

      expect(sendResult).toBeNull();
      expect(streamSpy).toHaveBeenCalled();
      expect(callableSpy).not.toHaveBeenCalled();
      expect(result.current.error).toContain('Модель сейчас не отвечает');
    });

    it('falls back to callableChat on retryable server errors', async () => {
      vi.spyOn(transport, 'streamChat').mockRejectedValue(new Error('SERVER_ERROR'));
      const callableSpy = vi.spyOn(transport, 'callableChat').mockResolvedValue('Ответ от фолбека');

      const { result } = renderHook(() => useAIChat(null, 'editor'));

      await act(async () => {
        await result.current.sendMessage('Привет');
      });

      expect(callableSpy).toHaveBeenCalled();
      expect(result.current.error).toBeNull();
      expect(result.current.dialogue?.messages.some(m => m.content === 'Ответ от фолбека')).toBe(true);
    });
  });

  describe('AG-CHAT-2: Dialogue race conditions', () => {
    it('regenerateLast does not destroy original answer in IndexedDB if regeneration fails', async () => {
      const db = await getLocalDb();
      const dialogueId = 'diag-test-1';
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
          { role: 'assistant', content: 'Ответ один', variants: ['Ответ один v0'] },
        ],
      };
      await db.put('aiDialogues', initialDialogue);

      // Fail during regeneration
      vi.spyOn(transport, 'streamChat').mockRejectedValue(new Error('RATE_LIMIT'));

      const { result } = renderHook(() => useAIChat(dialogueId, 'editor'));

      // Wait for dialogue to load into hook state
      await waitFor(() => {
        expect(result.current.dialogue?.messages.length).toBe(2);
      });

      // Attempt regenerate
      await act(async () => {
        await result.current.regenerateLast();
      });

      // Assert error set
      expect(result.current.error).toContain('Слишком частые запросы');

      // Assert dialogue in IndexedDB still contains the original assistant message!
      const stored = await db.get('aiDialogues', dialogueId);
      expect(stored?.messages.length).toBe(2);
      expect(stored?.messages[1]?.content).toBe('Ответ один');
      expect(stored?.messages[1]?.variants).toEqual(['Ответ один v0']);
    });

    it('dialogue-updated event merges and does not wipe optimistic pending messages', async () => {
      const db = await getLocalDb();
      const dialogueId = 'diag-test-2';
      const storedDialogue: AIDialogue = {
        id: dialogueId,
        title: 'Тест диалог 2',
        personaId: 'editor',
        personaName: 'Редактор',
        personaEmoji: '✍️',
        createdAt: 1000,
        updatedAt: 1000,
        messages: [
          { role: 'user', content: 'Привет' },
        ],
      };
      await db.put('aiDialogues', storedDialogue);

      const { result } = renderHook(() => useAIChat(dialogueId, 'editor'));

      await waitFor(() => {
        expect(result.current.dialogue?.messages.length).toBe(1);
      });

      // Stream blocks or is in flight
      let resolveStream!: (val: string) => void;
      const streamPromise = new Promise<string>(r => { resolveStream = r; });
      vi.spyOn(transport, 'streamChat').mockImplementation(async (opts) => {
        const text = await streamPromise;
        opts.onChunk(text, '');
        return text;
      });

      // Send a new message (adds optimistic turn to hook state)
      let sendPromise: Promise<any>;
      act(() => {
        sendPromise = result.current.sendMessage('Второй вопрос');
      });

      await waitFor(() => {
        expect(result.current.dialogue?.messages.length).toBe(2);
      });

      // Fire dialogue-updated event from external update (e.g. title rename on disk)
      act(() => {
        window.dispatchEvent(new CustomEvent('dialogue-updated'));
      });

      await act(async () => {
        await new Promise(r => setTimeout(r, 20));
      });

      // Optimistic message must NOT be wiped!
      expect(result.current.dialogue?.messages.length).toBe(2);
      expect(result.current.dialogue?.messages[1]?.content).toBe('Второй вопрос');

      // Finish stream
      await act(async () => {
        resolveStream('Второй ответ');
        await sendPromise;
      });

      const dbDiag = await db.get('aiDialogues', dialogueId);
      expect(dbDiag?.messages.length).toBe(3);
      expect(result.current.dialogue?.messages.length).toBe(3);
    });

    it('persona switch effect reads fresh record from IDB and guards write', async () => {
      const db = await getLocalDb();
      const dialogueId = 'diag-test-3';
      const storedDialogue: AIDialogue = {
        id: dialogueId,
        title: 'Тест диалог 3',
        personaId: 'editor',
        personaName: 'Редактор',
        personaEmoji: '✍️',
        createdAt: 1000,
        updatedAt: 1000,
        messages: [
          { role: 'user', content: 'Привет' },
        ],
      };
      await db.put('aiDialogues', storedDialogue);

      const { result, rerender } = renderHook(
        ({ pId }) => useAIChat(dialogueId, pId),
        { initialProps: { pId: 'editor' } }
      );

      await waitFor(() => {
        expect(result.current.dialogue?.messages.length).toBe(1);
      });

      // Switch persona to 'coach'
      rerender({ pId: 'coach' });

      await waitFor(() => {
        expect(result.current.dialogue?.personaId).toBe('coach');
      });

      const updatedDb = await db.get('aiDialogues', dialogueId);
      expect(updatedDb?.personaId).toBe('coach');
      expect(updatedDb?.messages.some(m => m.type === 'system' && m.content.includes('Смена персоны'))).toBe(true);
    });
  });
});
