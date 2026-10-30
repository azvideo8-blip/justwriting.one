import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';
// Дейлик 30.10, подозрение → DY10-6: флаг кризисного хода (DLG-Q3) уходил в
// стрим и в прямой callable, но не в callableChat-запасной путь после сбоя
// стрима (useAIChat.ts:765) — сервер собирал ответ без кризисных инструкций.
// Pre-existing (было и в 0.10.11). Мутация: убрать crisis из запасного вызова → красный.

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ language: 'ru', t: (k: string) => k }),
}));
vi.mock('../../services/aiChatContext', () => ({
  useAIChatContext: () => ({
    buildContext: vi.fn().mockResolvedValue({
      userPortrait: null,
      customPersona: undefined,
      // женские формы — детектор обязан дать 'f'
      searchContext: 'Я назвала сумму и потом весь день прокручивала этот разговор.',
      memoryContext: null,
      injectedDocumentIds: [],
      injectedTitles: [],
      allowedFirstSeenDates: [],
      degradedReason: null,
      // кризис определяет сборщик контекста (detectRisk) — здесь он подменён
      crisis: true,
    }),
    getAttachedNote: vi.fn().mockReturnValue(null),
    setAttachedNote: vi.fn(),
    getMessageCount: vi.fn().mockReturnValue(1),
    incrementMessageCount: vi.fn(),
    resetSession: vi.fn(),
  }),
}));

describe('DY10-6: кризисный флаг доезжает до запасного пути', () => {
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

  it('стрим упал на кризисном ходе → callableChat получает crisis: true', async () => {
    const streamParams: { crisis?: boolean }[] = [];
    vi.spyOn(transport, 'streamChat').mockImplementation(async (params) => {
      streamParams.push(params as { crisis?: boolean });
      throw new Error('INTERNAL');
    });
    const callableCalls: { crisis?: boolean }[] = [];
    vi.spyOn(transport, 'callableChat').mockImplementation(async (params) => {
      callableCalls.push(params as { crisis?: boolean });
      return 'Я рядом.';
    });

    const { result } = renderHook(() => useAIChat(null, 'cbt'));
    await act(async () => {
      await result.current.sendMessage('не хочу жить');
    });

    expect(streamParams[0]?.crisis, 'стрим без кризисного флага — сценарий не кризисный').toBe(true);
    expect(callableCalls, 'запасной путь не вызван — проверка не исполнена').toHaveLength(1);
    expect(callableCalls[0]?.crisis, 'запасной путь без кризисного флага').toBe(true);
  });
});
