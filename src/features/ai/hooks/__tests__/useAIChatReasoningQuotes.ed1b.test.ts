import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb, type AIDialogue } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';

/**
 * ED-1b: сохранённый ход мыслей чистился стражем кавычек вместе с ответом —
 * во время стрима «по смыслу» в нём не было, а в истории появлялась. Тест идёт
 * через сохранение диалога, а не через sanitizeCitations напрямую.
 *
 * (Шапка моков — как в useAIChatInterruptedTurn.test.ts.)
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

const QUESTION = 'Как тебе этот кусок?';
// Цитаты от первого лица, которых нет в материалах хода (материалы — только вопрос).
const REASONING_QUOTE = 'я долго не решался написать этот пост';
const ANSWER_QUOTE = 'мне страшно было туда возвращаться';

async function storedDialogues() {
  const db = await getLocalDb();
  return db.getAll('aiDialogues') as Promise<AIDialogue[]>;
}

describe('ED-1b: страж кавычек не трогает сохранённый ход мыслей', () => {
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
      remaining: 10, limit: 10, reasoningRemaining: 10, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false,
    } as never);
  });

  async function send(full: string) {
    vi.spyOn(transport, 'streamChat').mockImplementation(async (params) => {
      params.onChunk(full, null);
      return full;
    });
    const { result } = renderHook(() => useAIChat(null, 'cbt', undefined, true));
    await act(async () => {
      await result.current.sendMessage(QUESTION);
    });
    let msg: AIDialogue['messages'][number] | undefined;
    await waitFor(async () => {
      msg = (await storedDialogues())[0]?.messages.find(m => m.role === 'assistant');
      expect(msg).toBeDefined();
    });
    return msg!;
  }

  it('ход мыслей сохраняется без «по смыслу», ответ у психолога — с меткой', async () => {
    const msg = await send(`ХОД МЫСЛИ:\nМожно начать с «${REASONING_QUOTE}».\nОТВЕТ:\nТы пишешь, что «${ANSWER_QUOTE}».`);
    expect(msg.reasoning).toContain(`«${REASONING_QUOTE}»`);
    expect(msg.reasoning).not.toMatch(/по смыслу/i);
    expect(msg.content).toMatch(/по смыслу: мне страшно/i);
  });

  it('ответ не дошёл — весь текст в ходе мыслей, тоже без «по смыслу»', async () => {
    const msg = await send(`ХОД МЫСЛИ:\nМожно начать с «${REASONING_QUOTE}», а дальше`);
    expect(msg.reasoning).toContain(`«${REASONING_QUOTE}»`);
    expect(msg.reasoning).not.toMatch(/по смыслу/i);
  });
});
