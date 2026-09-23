import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { AIChatMemoryService } from '../../services/AIChatMemoryService';
import { setChatExtrasEnabled } from '../../../../core/ai/chatExtrasPreference';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));
vi.mock('../../../../core/auth', async (orig) => ({
  ...(await orig<typeof import('../../../../core/auth')>()),
  getCurrentUser: () => ({ uid: 'u_extras' }),
}));
vi.mock('../../services/aiChatContext', () => ({
  useAIChatContext: () => ({
    buildContext: vi.fn().mockResolvedValue({
      userPortrait: null, customPersona: undefined, searchContext: '', memoryContext: null,
      injectedDocumentIds: [], allowedFirstSeenDates: [], degradedReason: null,
    }),
    getAttachedNote: vi.fn().mockReturnValue(null),
    setAttachedNote: vi.fn(),
    getMessageCount: vi.fn().mockReturnValue(3), // каждый третий ход — извлечение памяти
    incrementMessageCount: vi.fn(),
    resetSession: vi.fn(),
  }),
}));

// EA-18: «Память ИИ и подсказки» выключены — после ответа разговор больше
// никуда не уходит.
describe('memory extraction honours the chat-extras switch (EA-18)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    transport._resetStreamUnavailable();
    useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100000), loaded: true, isAdmin: false });
    vi.spyOn(transport, 'streamChat').mockRejectedValue(new Error('SERVER_ERROR'));
    vi.spyOn(transport, 'callableChat').mockResolvedValue('Ответ');
  });

  it.each([
    ['off', false, 0],
    ['on', true, 1],
  ])('extracts memory only when extras are %s', async (_label, enabled, calls) => {
    setChatExtrasEnabled('u_extras', enabled);
    const extract = vi.spyOn(AIChatMemoryService, 'extractFromDialogue').mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useAIChat(null, 'editor'));
    await act(async () => { await result.current.sendMessage('Привет'); });
    expect(extract).toHaveBeenCalledTimes(calls);
  });
});
