import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb, type AIDialogue } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { AIDialogueService } from '../../services/AIDialogueService';
import { useAiLimitStore } from '../../store/useAiLimitStore';

// S-25 внутри S-29: перегенерация отвечает по id заменяемого хода. Прежний
// `fromIndex` из состояния вкладки срезал `splice(fromIndex)` — и ход, дописанный
// за это время соседней вкладкой, исчезал из дневника.

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ language: 'ru', t: (k: string) => k }),
}));
vi.mock('../../services/aiChatContext', () => ({
  useAIChatContext: () => ({
    buildContext: vi.fn().mockResolvedValue({
      userPortrait: null, customPersona: undefined, searchContext: '', memoryContext: null,
      injectedDocumentIds: [], allowedFirstSeenDates: [], degradedReason: null,
    }),
    getAttachedNote: vi.fn().mockReturnValue(null),
    setAttachedNote: vi.fn(),
    getMessageCount: vi.fn().mockReturnValue(1),
    incrementMessageCount: vi.fn(),
    resetSession: vi.fn(),
  }),
}));

const DIALOGUE_ID = 'diag-race-1';

beforeEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  transport._resetStreamUnavailable();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false });
  const db = await getLocalDb();
  for (const rec of await db.getAll('aiDialogues')) await db.delete('aiDialogues', rec.id);
  await db.put('aiDialogues', {
    id: DIALOGUE_ID,
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
  } as AIDialogue);
});

describe('S-25: regenerate while another tab appends', { timeout: 30_000 }, () => {
  it('the turn appended between capture and save survives', async () => {
    let holdStream: () => void = () => {};
    const gate = new Promise<void>(resolve => { holdStream = resolve; });
    vi.spyOn(transport, 'streamChat').mockImplementation(async opts => {
      opts.onChunk('Ответ новый', '');
      await gate;
      return 'Ответ новый';
    });

    const { result } = renderHook(() => useAIChat(DIALOGUE_ID, 'editor'));
    await waitFor(() => {
      expect(result.current.dialogue?.messages.length).toBe(2);
    });

    let regenerating: Promise<void> | undefined;
    await act(async () => {
      regenerating = result.current.regenerateLast();
      // Соседняя вкладка дописывает ход, пока наш стрим держится.
      await AIDialogueService.appendMessage(DIALOGUE_ID, 'Вопрос из другой вкладки', 'Ответ из другой вкладки');
      holdStream();
      await regenerating;
    });

    const stored = (await (await getLocalDb()).get('aiDialogues', DIALOGUE_ID)) as AIDialogue;
    const texts = stored.messages.map(m => m.content);
    expect(texts, `чужой ход срезан: ${JSON.stringify(texts)}`).toContain('Вопрос из другой вкладки');
    expect(texts).toContain('Ответ из другой вкладки');
    expect(texts).toContain('Ответ новый');
    expect(stored.deletedMessages ?? []).toEqual([]);
    // S-36: варианты — у перегенерированного ответа, на его месте, под его id;
    // чужой ход, дописанный позже, их не получает, и вопрос не дублируется.
    expect(texts, `вопрос продублирован: ${JSON.stringify(texts)}`).toEqual(['Вопрос один', 'Ответ новый', 'Вопрос из другой вкладки', 'Ответ из другой вкладки']);
    expect(stored.messages[1]?.variants).toEqual(['Ответ один', 'Ответ новый']);
    expect(stored.messages[3]?.variants, 'варианты достались чужому ходу').toBeUndefined();
  });
});
