import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb, type AIDialogue } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import type { AttachedNoteRef } from '../../services/aiChatContext';

// К21-4 (случай #21, 21.2): признак «пересказал записи без ссылки» считается на
// клиенте один раз при сохранении — материалы хода не хранятся, и после
// перезагрузки пересчитать его нечем. Правило то же, что считает сервер
// (notesRefRule), поэтому пометка под ответом и счётчик в журнале не расходятся.
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

const FOUND = 'local_k214_found';

const DELIVERY = [
  'Результаты поиска по архиву заметок',
  'Найдено заметок: 1.',
  `[#${FOUND} · 12.10.2026]`,
  'Заметка 1: "Утренняя смена"',
  'Подъём в шесть, дорога пустая.',
].join('\n');
const NO_DELIVERY = '[Прикреплена заметка: "Утренняя смена"]\nПодъём в шесть, дорога пустая.';

function ctx(extra: Record<string, unknown> = {}) {
  return {
    userPortrait: null, customPersona: undefined, searchContext: DELIVERY, memoryContext: null,
    injectedDocumentIds: [FOUND], allowedFirstSeenDates: [], ...extra,
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
  await db.put('documents', { id: FOUND, guestId: 'u1', title: 'Утренняя смена', currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [] } as never);
});

async function turn(id: string, question: string, answer: string, extra: Record<string, unknown> = {}) {
  vi.spyOn(transport, 'streamChat').mockImplementation(async o => { o.onChunk(answer, ''); return answer; });
  await seed(id, []);
  h.buildContext.mockResolvedValue(ctx(extra));
  const { result } = renderHook(() => useAIChat(id, 'coach'));
  await act(async () => { await result.current.sendMessage(question); });
  await waitFor(async () => expect((await storedAnswer(id))?.content).toContain(answer.slice(0, 12)));
  return storedAnswer(id);
}

describe('К21-4: признак сохраняется в реплике ассистента', () => {
  it('пересказ записей без ссылки при выдаче — поле true', async () => {
    const saved = await turn('d-k214', 'о чём я писал утром?', 'В записях ты писал про подъём в шесть.');
    expect(saved?.notesClaimNoRef).toBe(true);
  });

  it('со ссылкой — поля нет', async () => {
    const saved = await turn('d-k214-ref', 'о чём я писал утром?', `В записях ты писал про подъём в шесть [#${FOUND}].`);
    expect(saved?.notesClaimNoRef).toBeUndefined();
  });

  it('ход без выдачи — поля нет, ссылаться не на что', async () => {
    const saved = await turn('d-k214-nodelivery', 'что скажешь про запись?', 'В записях ты писал про подъём в шесть.', { searchContext: NO_DELIVERY });
    expect(saved?.notesClaimNoRef).toBeUndefined();
  });
});
