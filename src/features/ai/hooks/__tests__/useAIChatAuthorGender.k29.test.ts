// К29-1: род считается по репликам и приложенной записи для всех характеров и раскрывает
// скобку в ответе. Над настоящим useAIChat; подменены только край и контекст хода.
// Мутации: не раскрывать скобку; считать род по searchContext; брать скрытые блоки — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { linkedNote } from '../../../../test/attachedTurnFixtures';
import type { AttachedNoteRef } from '../../services/aiChatContext';

const h = vi.hoisted(() => ({ buildContext: vi.fn(), attached: null as null | AttachedNoteRef }));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));
vi.mock('../../services/aiChatContext', () => ({
  useAIChatContext: () => ({
    buildContext: h.buildContext,
    getAttachedNote: () => h.attached,
    setAttachedNote: (n: typeof h.attached) => { h.attached = n; },
    getMessageCount: () => 1,
    incrementMessageCount: () => {},
    resetSession: () => {},
  }),
}));

const HER = 'Я проснулась рано. Потом я долго ждала. К вечеру я устала.';
const HIS = 'Я проснулся рано. Потом я долго ждал. К вечеру я устал.';
const ANSWER = 'Ты сделал(а) это и устал(а). «Он сделал(а)».';

async function setup(note: string, searchContext: string) {
  h.attached = linkedNote('local_n1', note);
  h.buildContext.mockResolvedValue({
    userPortrait: null, customPersona: undefined, searchContext, memoryContext: null,
    injectedDocumentIds: ['local_n1'], allowedFirstSeenDates: [],
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  h.buildContext.mockReset();
  localStorage.clear();
  transport._resetStreamUnavailable();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100000), loaded: true, isAdmin: false });
  const db = await getLocalDb();
  for (const rec of await db.getAll('aiDialogues')) await db.delete('aiDialogues', rec.id);
  await db.clear('documents');
  await db.put('documents', { id: 'local_n1', guestId: 'u1', title: 'n', currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [] } as never);
});

async function turn(text: string, answer = ANSWER, reasoning = '', persona = 'ta') {
  const shown: string[] = [];
  const sent: { authorGender?: string | undefined }[] = [];
  let release: () => void = () => {};
  vi.spyOn(transport, 'streamChat').mockImplementation(async o => {
    sent.push(o as never);
    o.onChunk(answer, reasoning);
    await new Promise<void>(r => { release = r; });
    return reasoning ? `<reasoning>${reasoning}</reasoning><answer>${answer}</answer>` : answer;
  });
  const { result } = renderHook(() => useAIChat(null, persona, 'standard', Boolean(reasoning) as never));
  let done: Promise<unknown> = Promise.resolve();
  act(() => { done = result.current.sendMessage(text); });
  await waitFor(() => expect(result.current.streamingMessage ?? '').toContain('Ты'));
  shown.push(result.current.streamingMessage ?? '', result.current.streamingReasoning ?? '');
  await act(async () => { release(); await done; });
  return { gender: sent[0]!.authorGender, shown, last: result.current.dialogue!.messages.at(-1)! };
}

describe('К29-1: род человека — в ход и в ответ', () => {
  it('род — по приложенной записи, у любого характера; скобка раскрыта в потоке и в сохранённом', async () => {
    await setup(HER, '');
    const r = await turn('разбери запись');
    expect(r.gender).toBe('f');
    expect(r.shown[0]).toBe('Ты сделала это и устала. «Он сделал(а)».');
    expect(r.last.content).toBe('Ты сделала это и устала. «Он сделал(а)».');
  });

  it('род — по репликам человека', async () => {
    await setup('Запись без форм.', '');
    expect((await turn(HIS)).gender).toBe('m');
  });

  it('найденные записи в счёт не идут', async () => {
    await setup('Запись без форм.', HER);
    const r = await turn('что скажешь?');
    expect(r.gender).toBeUndefined();
    expect(r.last.content).toContain('сделал(а)');
  });

  it('Редактору, когда больше негде, — найденные записи', async () => {
    await setup('Запись без форм.', HER);
    expect((await turn('собери пост', ANSWER, '', 'editor')).gender).toBe('f');
  });

  it('скрытая приложенная запись род не задаёт', async () => {
    const db = await getLocalDb();
    await db.put('documents', { ...(await db.get('documents', 'local_n1'))!, excludedFromAI: true });
    await setup(HER, '');
    expect((await turn('что скажешь?')).gender).toBeUndefined();
  });

  it('вставленный текст род не задаёт', async () => {
    await setup(HER, '');
    h.attached = { ...h.attached!, blocks: h.attached!.blocks.map(b => ({ ...b, documentId: 'pasted-1' })) };
    expect((await turn('что скажешь?')).gender).toBeUndefined();
  });

  it('запись, названная написанной ИИ, род не задаёт', async () => {
    await setup(HER, '');
    expect((await turn('Этот текст написал ИИ. Что скажешь?')).gender).toBeUndefined();
  });

  it('ход мысли не правится', async () => {
    await setup(HER, '');
    const r = await turn('разбери запись', ANSWER, 'Он сделал(а) это.');
    expect(r.shown[1]).toContain('сделал(а)');
    expect(r.last.reasoning).toContain('сделал(а)');
  });
});
