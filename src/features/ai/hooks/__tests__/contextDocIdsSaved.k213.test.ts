import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb, type AIDialogue } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import type { AttachedNoteRef } from '../../services/aiChatContext';

// К21-3 (случай #21, 21.1 (3)): материалы хода обязаны пережить перезагрузку и
// синхронизацию — иначе «откуда ты это взял» снова останется без источника.
// Реплика ассистента хранит id заметок, ушедших модели; скрытые, удалённые и
// заметки в корзине в этот список не попадают (как hiddenCiteIds).
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

const SEEN = 'local_k213_seen';
const HIDDEN = 'local_k213_hidden';
const GONE = 'local_k213_gone';

function ctx(extra: Record<string, unknown> = {}) {
  return {
    userPortrait: null, customPersona: undefined, searchContext: '', memoryContext: null,
    injectedDocumentIds: [SEEN, HIDDEN, GONE], allowedFirstSeenDates: [], ...extra,
  };
}

async function seed(id: string, messages: AIDialogue['messages']) {
  const db = await getLocalDb();
  await db.put('aiDialogues', {
    id, title: 't', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    createdAt: 1, updatedAt: 1, messages,
  } as never);
}

const storedAnswer = async (id: string) => {
  const d = await (await getLocalDb()).get('aiDialogues', id);
  return d?.messages.filter(m => m.role === 'assistant').at(-1);
};

beforeEach(async () => {
  vi.restoreAllMocks();
  h.buildContext.mockReset();
  h.attached = null;
  h.msgCount = 1;
  localStorage.clear();
  transport._resetStreamUnavailable();
  useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100000), loaded: true, isAdmin: false });
  const db = await getLocalDb();
  for (const rec of await db.getAll('aiDialogues')) await db.delete('aiDialogues', rec.id);
  await db.clear('documents');
  await db.put('documents', { id: SEEN, guestId: 'u1', title: 'Утро', currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [] } as never);
  await db.put('documents', { id: HIDDEN, guestId: 'u1', title: 'Скрытая', currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [], excludedFromAI: true } as never);
  vi.spyOn(transport, 'streamChat').mockImplementation(async o => { o.onChunk('ответ', ''); return 'ответ'; });
});

describe('К21-3: материалы хода сохраняются в реплике ассистента', () => {
  it('ход записывает contextDocIds без скрытых и несуществующих заметок', async () => {
    await seed('d-k213', []);
    h.buildContext.mockResolvedValue(ctx());
    const { result } = renderHook(() => useAIChat('d-k213', 'coach'));
    await act(async () => { await result.current.sendMessage('о чём я писал утром?'); });

    await waitFor(async () => expect((await storedAnswer('d-k213'))?.content).toBe('ответ'));
    expect(await storedAnswer('d-k213')).toMatchObject({ contextDocIds: [SEEN] });
  });

  it('«Ответить иначе» перезаписывает поле материалами нового хода', async () => {
    await seed('d-k213-regen', [
      { role: 'user', content: 'о чём я писал утром?' },
      { role: 'assistant', content: 'старый ответ', contextDocIds: ['local_old'] },
    ]);
    h.buildContext.mockResolvedValue(ctx({ injectedDocumentIds: [SEEN] }));
    const { result } = renderHook(() => useAIChat('d-k213-regen', 'coach'));
    await waitFor(() => expect(result.current.dialogue?.messages.length).toBe(2));
    await act(async () => { await result.current.regenerateLast(); });

    await waitFor(async () => expect((await storedAnswer('d-k213-regen'))?.content).toBe('ответ'));
    expect(await storedAnswer('d-k213-regen')).toMatchObject({ contextDocIds: [SEEN] });
  });

  it('пустой список материалов поля не заводит', async () => {
    await seed('d-k213-empty', []);
    h.buildContext.mockResolvedValue(ctx({ injectedDocumentIds: [] }));
    const { result } = renderHook(() => useAIChat('d-k213-empty', 'coach'));
    await act(async () => { await result.current.sendMessage('привет'); });

    await waitFor(async () => expect((await storedAnswer('d-k213-empty'))?.content).toBe('ответ'));
    expect((await storedAnswer('d-k213-empty'))?.contextDocIds).toBeUndefined();
  });
});
