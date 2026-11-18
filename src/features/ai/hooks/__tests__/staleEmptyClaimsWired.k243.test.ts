import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb, type AIDialogue } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import type { AttachedNoteRef } from '../../services/aiChatContext';

const h = vi.hoisted(() => ({
  buildContext: vi.fn(),
  attached: null as null | AttachedNoteRef,
  msgCount: 1,
}));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ language: 'ru', t: (k: string) => k, tp: (k: string) => k }),
}));
vi.mock('../../services/aiChatContext', () => ({
  useAIChatContext: () => ({
    buildContext: h.buildContext,
    getAttachedNote: () => h.attached,
    setAttachedNote: (n: typeof h.attached) => { h.attached = n; },
    getMessageCount: () => h.msgCount,
    incrementMessageCount: () => {},
    resetSession: () => {},
  }),
}));

// К24-3: прошлый ответ-отказ не уходит модели в ходе, где выдача есть. Синтетика.
const SEEN = 'local_k243w_seen';
const REFUSAL = 'По этому запросу в записях ничего не нашлось.';
const RESULTS = '\n\nРезультаты поиска по архиву заметок. Найдено заметок: 1.\n\n[#local_k243w_seen · 2026-11-01]\nЗаметка 1: "Река"\nтекст';

async function seed(id: string, messages: AIDialogue['messages']) {
  const db = await getLocalDb();
  await db.put('aiDialogues', {
    id, title: 't', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    createdAt: 1, updatedAt: 1, messages,
  } as never);
}


beforeEach(async () => {
  vi.restoreAllMocks();
  h.buildContext.mockReset();
  h.buildContext.mockResolvedValue({
    userPortrait: null, customPersona: undefined, searchContext: RESULTS, memoryContext: null,
    injectedDocumentIds: [SEEN], allowedFirstSeenDates: [],
  });
  h.attached = null;
  h.msgCount = 1;
  localStorage.clear();
  transport._resetStreamUnavailable();
  useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100000), loaded: true, isAdmin: false });
  vi.spyOn(transport, 'streamChat').mockImplementation(async o => { o.onChunk('ответ', ''); return 'ответ'; });
});


describe('К24-3: в ход с выдачей прошлый отказ не уходит модели', () => {
  it('сообщения модели — без прошлого «ничего не нашлось»', async () => {
    await seed('d-k243w', [
      { role: 'user', content: 'посмотри в той заметке' },
      { role: 'assistant', content: REFUSAL },
    ]);
    const { result } = renderHook(() => useAIChat('d-k243w', 'coach'));
    await waitFor(() => expect(result.current.dialogue?.messages.length).toBe(2));
    await act(async () => { await result.current.sendMessage('поищи похожее'); });
    const sent = vi.mocked(transport.streamChat).mock.calls.at(-1)?.[0] as { messages: Array<{ role: string; content: string }> } | undefined;
    expect(sent).toBeDefined();
    expect(sent!.messages.map(m => m.content).join('\n')).not.toContain('ничего не нашлось');
    expect(sent!.messages.find(m => m.role === 'assistant')?.content).toBe(transport.STALE_EMPTY_CLAIM_NOTE);
  });
});
