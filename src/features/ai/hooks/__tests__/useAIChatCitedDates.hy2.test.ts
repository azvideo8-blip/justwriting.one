// HY-2 на уровне хука: на ходе с гипотезой дата у ссылки в сохранённом ответе —
// дата записи из материалов хода; на обычном ходе ответ не меняется.
// Мутация: убрать fixCitedDates из guardDates в useAIChat → красный первый кейс.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { HYPOTHESIS_TURN_MARK } from '../../../../shared/ai/hypothesisRule';

const h = vi.hoisted(() => ({ buildContext: vi.fn() }));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ language: 'ru', t: (k: string) => k }),
}));
vi.mock('../../services/aiChatContext', () => ({
  useAIChatContext: () => ({
    buildContext: h.buildContext,
    getAttachedNote: () => null,
    setAttachedNote: () => {},
    getMessageCount: () => 1,
    incrementMessageCount: () => {},
    resetSession: () => {},
  }),
}));

const ANSWER = 'В записи от 12 апреля [#A1] ты обещала себе сесть за круг. Похоже, дело не в лени.';
const ANCHORS = '[#A1 · 2026-09-03]\nЗаметка 1: "Глина"\nГлина так и лежит на балконе.\n\n[#A2 · 2026-04-12]\nЗаметка 2: "Пианино"\nСначала гаммы, потом двор.';

beforeEach(async () => {
  vi.restoreAllMocks();
  h.buildContext.mockReset();
  localStorage.clear();
  transport._resetStreamUnavailable();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100000), loaded: true, isAdmin: false });
  const db = await getLocalDb();
  for (const rec of await db.getAll('aiDialogues')) await db.delete('aiDialogues', rec.id);
  vi.spyOn(transport, 'streamChat').mockImplementation(async o => { o.onChunk(ANSWER, ''); return ANSWER; });
});

async function send(id: string, searchContext: string) {
  const db = await getLocalDb();
  await db.put('aiDialogues', { id, title: 't', personaId: 'coach', personaName: 'К', personaEmoji: '🙂', createdAt: 1, updatedAt: 1, messages: [{ role: 'user', content: 'привет' }, { role: 'assistant', content: 'привет' }] });
  h.buildContext.mockResolvedValue({
    userPortrait: null, customPersona: undefined, searchContext, memoryContext: null,
    injectedDocumentIds: ['A1', 'A2'], injectedTitles: [], allowedFirstSeenDates: [], degradedReason: null, crisis: false,
  });
  const { result } = renderHook(() => useAIChat(id, 'coach'));
  await waitFor(() => expect(result.current.dialogue?.messages.length).toBe(2));
  await act(async () => { await result.current.sendMessage('опять не подошла к кругу, злюсь на себя'); });
  return db.get('aiDialogues', id);
}

describe('useAIChat: страж дат у ссылок на ходе с гипотезой', () => {
  it('ход с гипотезой: неверная дата в ответе заменена датой записи', async () => {
    const d = (await send('d-hy2-on', `${HYPOTHESIS_TURN_MARK}\n\n[Опоры — 2 записей разных дней]\n${ANCHORS}`))!;
    const answer = d.messages.at(-1)!;
    expect(answer.content).toContain('3 сентября');
    expect(answer.content).not.toContain('12 апреля');
    expect(answer.content).toContain('[#A1]');
  });

  it('обычный ход без метки: дата не тронута', async () => {
    const d = (await send('d-hy2-off', `Записи:\n${ANCHORS}`))!;
    expect(d.messages.at(-1)!.content).toContain('12 апреля');
    expect(d.messages.at(-1)!.content).not.toContain('3 сентября');
  });
});