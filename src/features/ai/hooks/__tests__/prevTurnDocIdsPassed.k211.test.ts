import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb, type AIDialogue } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import type { AttachedNoteRef } from '../../services/aiChatContext';

// К21-1 (случай #21, 21.1 (1)): материалы прошлого ответа живут в реплике
// ассистента (К21-3), а ход о происхождении сказанного собирает контекст заново.
// Чтобы он взял те же записи после перезагрузки вкладки, id прошлой реплики
// обязаны доехать до buildContext — отдельным полем, а не в истории для модели.
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

const SEEN = 'local_k211w_seen';
const SECOND = 'local_k211w_second';

async function seed(id: string, messages: AIDialogue['messages']) {
  const db = await getLocalDb();
  await db.put('aiDialogues', {
    id, title: 't', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    createdAt: 1, updatedAt: 1, messages,
  } as never);
}

const lastCall = () => h.buildContext.mock.calls.at(-1)?.[0] as { prevTurnDocIds?: string[] } | undefined;

beforeEach(async () => {
  vi.restoreAllMocks();
  h.buildContext.mockReset();
  h.buildContext.mockResolvedValue({
    userPortrait: null, customPersona: undefined, searchContext: '', memoryContext: null,
    injectedDocumentIds: [SEEN], allowedFirstSeenDates: [],
  });
  h.attached = null;
  h.msgCount = 1;
  localStorage.clear();
  transport._resetStreamUnavailable();
  useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100000), loaded: true, isAdmin: false });
  vi.spyOn(transport, 'streamChat').mockImplementation(async o => { o.onChunk('ответ', ''); return 'ответ'; });
});

describe('К21-1: id заметок прошлого ответа доезжают до сборщика контекста', () => {
  it('прошлая реплика с contextDocIds — поле в параметрах хода', async () => {
    await seed('d-k211w', [
      { role: 'user', content: 'что у меня было про сроки' },
      { role: 'assistant', content: 'Сроки звучат в разговоре [#local_k211w_seen]', contextDocIds: [SEEN, SECOND] },
    ]);
    const { result } = renderHook(() => useAIChat('d-k211w', 'coach'));
    await waitFor(() => expect(result.current.dialogue?.messages.length).toBe(2));
    await act(async () => { await result.current.sendMessage('Откуда ты это взял?'); });

    await waitFor(() => expect(h.buildContext).toHaveBeenCalled());
    expect(lastCall()?.prevTurnDocIds).toEqual([SEEN, SECOND]);
  });

  it('в прошлой реплике поля нет — и в параметрах его нет', async () => {
    await seed('d-k211w-old', [
      { role: 'user', content: 'что у меня было про сроки' },
      { role: 'assistant', content: 'Сроки звучат в разговоре' },
    ]);
    const { result } = renderHook(() => useAIChat('d-k211w-old', 'coach'));
    await waitFor(() => expect(result.current.dialogue?.messages.length).toBe(2));
    await act(async () => { await result.current.sendMessage('Откуда ты это взял?'); });

    await waitFor(() => expect(h.buildContext).toHaveBeenCalled());
    expect(lastCall()?.prevTurnDocIds).toBeUndefined();
  });

  it('первый ход — брать нечего', async () => {
    await seed('d-k211w-first', []);
    const { result } = renderHook(() => useAIChat('d-k211w-first', 'coach'));
    await act(async () => { await result.current.sendMessage('Откуда ты это взял?'); });

    await waitFor(() => expect(h.buildContext).toHaveBeenCalled());
    expect(lastCall()?.prevTurnDocIds).toBeUndefined();
  });
});
