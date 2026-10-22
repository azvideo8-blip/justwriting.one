// A9 (FN-2б): строгий ход длиннее 49 000 знаков режется с начала молча — теперь
// после ответа в диалоге системная строка «Модели ушло около N из M знаков».
// Широкий ход и короткий строгий — без строки.
// Мутации: снять `turnMode === 'note'` → (b) красный; не звать appendSystemMessage → (a) красный;
// M без шапки «[Сегодня…]» → (a) красный; без `once` → (c) красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { getLocalDb } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';

const h = vi.hoisted(() => ({ buildContext: vi.fn() }));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ language: 'ru', t: (k: string, p?: Record<string, string | number>) => (p ? `${k}:${p.n}/${p.m}` : k) }),
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

const ctx = (searchContext: string, effectiveScope: 'note' | 'wide') => ({
  userPortrait: null, customPersona: undefined, searchContext, memoryContext: null,
  injectedDocumentIds: [], allowedFirstSeenDates: [], effectiveScope,
});

beforeEach(async () => {
  vi.restoreAllMocks();
  h.buildContext.mockReset();
  localStorage.clear();
  transport._resetStreamUnavailable();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100000), loaded: true, isAdmin: false });
  const db = await getLocalDb();
  for (const rec of await db.getAll('aiDialogues')) await db.delete('aiDialogues', rec.id);
  vi.spyOn(transport, 'streamChat').mockImplementation(async o => { o.onChunk('ок', ''); return 'ок'; });
});

async function send(id: string, searchContext: string, scope: 'note' | 'wide') {
  const db = await getLocalDb();
  await db.put('aiDialogues', { id, title: 't', personaId: 'coach', personaName: 'К', personaEmoji: '🙂', createdAt: 1, updatedAt: 1, messages: [{ role: 'user', content: 'привет' }, { role: 'assistant', content: 'привет' }] });
  h.buildContext.mockResolvedValue(ctx(searchContext, scope));
  const { result } = renderHook(() => useAIChat(id, 'coach'));
  await waitFor(() => expect(result.current.dialogue?.messages.length).toBe(2));
  await act(async () => { await result.current.sendMessage('что скажешь?'); });
  return db.get('aiDialogues', id);
}

describe('useAIChat: пометка об обрезке строгого хода', () => {
  it('(a) строгий ход 60 000 знаков → после ответа системная строка с N из M', async () => {
    const d = (await send('d-cut', 'я'.repeat(60_000), 'note'))!;
    const sys = d.messages.filter(m => m.type === 'system');
    expect(sys).toHaveLength(1);
    // M — весь контекст хода: заметка плюс шапка «[Сегодня: …]» (C9: число точное).
    const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    expect(sys[0]!.content).toBe(`ai_context_cut_notice:49000/${60_000 + `[Сегодня: ${today}]\n\n`.length}`);
    expect(d.messages.at(-1)!.type, 'строка после ответа').toBe('system');
  });

  it('(c) та же длинная заметка на следующем ходе — строка не дублируется', async () => {
    const db = await getLocalDb();
    await db.put('aiDialogues', { id: 'd-twice', title: 't', personaId: 'coach', personaName: 'К', personaEmoji: '🙂', createdAt: 1, updatedAt: 1, messages: [{ role: 'user', content: 'привет' }, { role: 'assistant', content: 'привет' }] });
    h.buildContext.mockResolvedValue(ctx('я'.repeat(60_000), 'note'));
    const { result } = renderHook(() => useAIChat('d-twice', 'coach'));
    await waitFor(() => expect(result.current.dialogue?.messages.length).toBe(2));
    await act(async () => { await result.current.sendMessage('что скажешь?'); });
    // Защита от частых запросов — не предмет теста.
    localStorage.removeItem('jw_ai_cooldown_until');
    localStorage.removeItem('jw_ai_inflight');
    await act(async () => { await result.current.sendMessage('а ещё?'); });
    const d = (await db.get('aiDialogues', 'd-twice'))!;
    expect(d.messages.filter(m => m.role === 'user')).toHaveLength(3);
    expect(d.messages.filter(m => m.type === 'system')).toHaveLength(1);
  });

  it('(b) широкий ход той же длины и короткий строгий — без строки', async () => {
    expect((await send('d-wide', 'я'.repeat(60_000), 'wide'))!.messages.some(m => m.type === 'system')).toBe(false);
    expect((await send('d-short', 'я'.repeat(1_000), 'note'))!.messages.some(m => m.type === 'system')).toBe(false);
  });
});
