// К28-1: в строгом ходе чужой день под ссылкой на приложенную запись чинится на клиенте —
// в потоке и в сохранённом ответе. Над настоящим useAIChat; подменён только край (streamChat),
// контекст хода и список заметок. Мутации: не вызывать repairRefs в сохранении — красный;
// не вызывать в потоке — красный.
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

const NOTE = 'Сегодня красил забор в саду и устал, зато закончил всю южную сторону участка.';
const PRIOR_ANSWER = 'Раньше ты находил выход: уходил гулять вечером вдоль реки, и тревога заметно отпускала [#local_august].';
const MODEL_ANSWER = 'Вечерняя прогулка вдоль реки помогала, тревога заметно отпускала [#local_n1]. Сегодня ты красил забор.';

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
  for (const id of ['local_n1', 'local_august']) {
    await db.put('documents', { id, guestId: 'u1', title: id, currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [] } as never);
  }
  h.attached = linkedNote('local_n1', NOTE);
  h.buildContext.mockResolvedValue({
    userPortrait: null, customPersona: undefined, searchContext: '', memoryContext: null,
    injectedDocumentIds: ['local_n1'], allowedFirstSeenDates: [],
  });
});

async function seedDialogue() {
  const db = await getLocalDb();
  await db.put('aiDialogues', {
    id: 'd-k28', title: 't', personaId: 'editor', personaName: 'Р', personaEmoji: '✍️', createdAt: 1, updatedAt: 1,
    messages: [{ role: 'user', content: 'расскажи про прошлое' }, { role: 'assistant', content: PRIOR_ANSWER }],
  });
}

async function runTurn() {
  await seedDialogue();
  vi.spyOn(transport, 'streamChat').mockImplementation(async o => { o.onChunk(MODEL_ANSWER, ''); return MODEL_ANSWER; });
  const { result } = renderHook(() => useAIChat('d-k28', 'editor'));
  await waitFor(() => expect(result.current.dialogue?.messages.length).toBe(2));
  await act(async () => { await result.current.sendMessage('а что сегодня?'); });
  return result;
}

describe('К28-1: строгий ход — ссылка чужого дня чинится кодом', () => {
  it('сохранённый ответ: содержание прошлой записи под ссылкой на приложенную → ссылка прошлой', async () => {
    const result = await runTurn();
    const last = result.current.dialogue!.messages.at(-1)!;
    expect(last.role).toBe('assistant');
    expect(last.content).toContain('отпускала [#local_august].');
    expect(last.content).not.toContain('[#local_n1]');
    expect(last.content).toContain('Сегодня ты красил забор.');
  });

  it('прошлая запись удалена с устройства — чужая ссылка не подставляется, ссылка снимается', async () => {
    const db = await getLocalDb();
    await db.delete('documents', 'local_august');
    const result = await runTurn();
    const last = result.current.dialogue!.messages.at(-1)!;
    expect(last.content).toContain('отпускала.');
    expect(last.content).not.toContain('[#');
  });

  it('поток: пользователь видит уже исправленную ссылку (ход ещё не завершён)', async () => {
    await seedDialogue();
    let release: () => void = () => {};
    vi.spyOn(transport, 'streamChat').mockImplementation(async o => {
      o.onChunk(MODEL_ANSWER, '');
      await new Promise<void>(r => { release = r; });
      return MODEL_ANSWER;
    });
    const { result } = renderHook(() => useAIChat('d-k28', 'editor'));
    await waitFor(() => expect(result.current.dialogue?.messages.length).toBe(2));
    let turn: Promise<unknown> = Promise.resolve();
    act(() => { turn = result.current.sendMessage('а что сегодня?'); });
    await waitFor(() => expect(result.current.streamingMessage ?? '').toContain('отпускала'));
    expect(result.current.streamingMessage).toContain('отпускала [#local_august].');
    expect(result.current.streamingMessage).not.toContain('[#local_n1]');
    await act(async () => { release(); await turn; });
  });
});
