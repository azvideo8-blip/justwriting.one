import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb, type AIDialogue } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';

/**
 * SB-3: реплика пользователя жила только вместе с ОТВЕТОМ.
 *
 * Аппенд пишет пару «вопрос + ответ» одной операцией в конце успешного прохода
 * (useAIChat → AIDialogueService.appendMessage). Если стрим оборвался — человек
 * нажал «стоп» или сеть умерла после первых кусков, — выполнение уходит в catch,
 * пара не записывается, и из истории исчезает всё, что человек уже видел: и
 * partial ответа, и свой вопрос. На экране текст возвращается в поле ввода
 * (useAIPageData кладёт его обратно при отказе), но в дневнике хода не было.
 *
 * Остановка ДО первого куска ничего не теряла — сохраняемый ход не пишем,
 * пустой диалог убирает cleanupEmpty при следующем открытии.
 */

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ language: 'ru', t: (k: string) => k }),
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

const QUESTION = 'Почему кажется, что всё стоит?';
const PARTIAL = 'Похоже, что дело в';

async function storedDialogues() {
  const db = await getLocalDb();
  return db.getAll('aiDialogues') as Promise<AIDialogue[]>;
}

describe('SB-3: обрыв стрима не должен стирать показанный ход', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    transport._resetStreamUnavailable();
    const db = await getLocalDb();
    for (const rec of await db.getAll('aiDialogues')) {
      await db.delete('aiDialogues', (rec as { id: string }).id);
    }
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
    useAiLimitStore.setState({
      remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false,
    });
  });

  it('сбой после куска сохраняет вопрос и то, что модель успела сказать', async () => {
    vi.spyOn(transport, 'streamChat').mockImplementation(async (params) => {
      params.onChunk(PARTIAL, null);
      throw new Error('UPSTREAM');
    });
    vi.spyOn(transport, 'callableChat').mockResolvedValue('этого быть не должно');

    const { result } = renderHook(() => useAIChat(null, 'editor'));
    await act(async () => {
      await result.current.sendMessage(QUESTION);
    });

    await waitFor(async () => {
      const rows = await storedDialogues();
      expect(rows).toHaveLength(1);
      const messages = rows[0]?.messages ?? [];
      expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
      expect(messages[0]?.content).toBe(QUESTION);
      expect(messages[1]?.content).toContain(PARTIAL);
      // Оборванный ход не должен притворяться дописанным.
      expect(messages[1]?.content).toMatch(/не дописан|не дошл/);
    });
  });

  it('«стоп» после куска: транспорт отдаёт partial, и он сохраняется', async () => {
    // Как настоящий aiChatTransport: при остановке он не бросает, а возвращает
    // то, что уже пришло (строка «keep whatever streamed so far»).
    vi.spyOn(transport, 'streamChat').mockImplementation((params) => new Promise<string>((res) => {
      params.onChunk(PARTIAL, null);
      params.signal?.addEventListener('abort', () => res(PARTIAL));
    }));

    const { result } = renderHook(() => useAIChat(null, 'editor'));
    let send: Promise<string | null> | undefined;
    await act(async () => {
      send = result.current.sendMessage(QUESTION);
    });
    await waitFor(() => expect(result.current.streamingMessage).toBe(PARTIAL));
    await act(async () => {
      result.current.stop();
      await send;
    });

    const rows = await storedDialogues();
    expect(rows).toHaveLength(1);
    const messages = rows[0]?.messages ?? [];
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0]?.content).toBe(QUESTION);
    expect(messages[1]?.content).toContain(PARTIAL);
  });

  it('остановка до первого куска не пишет фантомный ход', async () => {
    vi.spyOn(transport, 'streamChat').mockImplementation((params) => new Promise<string>((_res, rej) => {
      params.signal?.addEventListener('abort', () => rej(new Error('ABORTED')));
    }));

    const { result } = renderHook(() => useAIChat(null, 'editor'));
    let send: Promise<string | null> | undefined;
    await act(async () => {
      send = result.current.sendMessage(QUESTION);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    await act(async () => {
      result.current.stop();
      await send;
    });

    const rows = await storedDialogues();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.messages).toEqual([]);
  });

  it('сбой ПОСЛЕ записанного хода не дописывает пару второй раз', async () => {
    // Ход уже в истории (appendMessage прошёл), а упал следующий шаг —
    // привязка заметки. Без отметки «ход сохранён» catch дописал бы ту же
    // пару ещё раз: вопрос задан дважды в дневнике.
    vi.spyOn(transport, 'streamChat').mockImplementation(async (params) => {
      params.onChunk(PARTIAL, null);
      return PARTIAL;
    });
    const { AIDialogueService } = await import('../../services/AIDialogueService');
    vi.spyOn(AIDialogueService, 'setDocumentId').mockRejectedValue(new Error('idb failure'));

    const { result } = renderHook(() => useAIChat(null, 'editor'));
    await act(async () => {
      await result.current.sendMessage(QUESTION, { content: 'Текст заметки', documentId: 'local_note1' });
    });

    const rows = await storedDialogues();
    const messages = rows[0]?.messages ?? [];
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(messages.filter(m => m.role === 'user')).toHaveLength(1);
  });
});
