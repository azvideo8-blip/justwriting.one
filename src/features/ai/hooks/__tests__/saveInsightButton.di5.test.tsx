// DI-5: кнопка «Сохранить вывод» — итог честно (успех только после 'saved'),
// quote:null не сохраняет ответ целиком, флаг и персона скрывают кнопку,
// двойной клик не шлёт второй запрос. Настоящие useSaveInsight / useServiceAction /
// AIChatMemoryService поверх fake-indexeddb; подменены край модели (pickInsight),
// флаг сервера, тосты и reportError. Мутации — в комментариях у кейсов.
import { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor, act, cleanup } from '@testing-library/react';
import 'fake-indexeddb/auto';

const toastSpy = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock('@/shared/components/Toast', () => ({
  useToast: () => ({ showToast: toastSpy.show }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/features/ai/services/AIService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/ai/services/AIService')>();
  return { ...actual, AIService: { ...actual.AIService, pickInsight: vi.fn() } };
});
vi.mock('@/core/sync/syncFlags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/sync/syncFlags')>();
  return { ...actual, chatInsightsEnabled: vi.fn() };
});
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { useSaveInsight } from '@/features/ai/hooks/useSaveInsight';
import { AIService } from '@/features/ai/services/AIService';
import { chatInsightsEnabled } from '@/core/sync/syncFlags';
import { AIChatMemoryService } from '@/features/ai/services/AIChatMemoryService';
import { AIDialogueService } from '@/features/ai/services/AIDialogueService';
import { AssistantTurn } from '@/features/ai/components/AIChatPresentational';
import { LocalStoreSyncService } from '@/core/services/LocalStoreSyncService';
import { getLocalDb, type AIDialogue } from '@/core/storage/localDb';
import { LanguageProvider } from '@/shared/i18n';
import { attachedTurn } from '@/features/ai/utils/attachedNoteFormat';

const QUOTE = 'Ты ждёшь разрешения на своё, и потому всё откладываешь.';
const REPLY = `${QUOTE} [#doc_1] Похоже на правду?`;
const PREV_USER = 'Опять сначала почта, потом посуда, потом ночь.';

let dlg: AIDialogue;

function wrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  cleanup();
  localStorage.setItem('language', 'ru');
  vi.mocked(chatInsightsEnabled).mockResolvedValue(true);
  vi.mocked(AIService.pickInsight).mockResolvedValue({ ok: true, quote: QUOTE });
  vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});
  const db = await getLocalDb();
  await db.clear('aiChatMemory');
  await db.clear('aiDialogues');
  await db.clear('documents');
  await db.put('documents', {
    id: 'doc_1', uuid: 'uuid-1', title: 'Синтетическая заметка', guestId: 'u_di5',
    currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 0,
    firstSessionAt: 1, lastSessionAt: 1, tags: [],
  });
  const created = await AIDialogueService.create({
    title: 'Синтетический разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🧭',
    messages: [
      { role: 'user', content: PREV_USER, type: 'chat' },
      { role: 'assistant', content: REPLY, type: 'chat' },
    ],
  });
  dlg = (await AIDialogueService.get(created.id))!;
});

describe('DI-5: useSaveInsight + кнопка', () => {
  it('клик → pickInsight с текстом ответа, запись confirmedBy button, тост успеха', async () => {
    const { result } = renderHook(() => useSaveInsight(dlg), { wrapper });
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => { result.current.handleSaveInsight(1); });
    await waitFor(() => expect(toastSpy.show).toHaveBeenCalledWith('Вывод сохранён', 'success'));
    expect(AIService.pickInsight).toHaveBeenCalledWith(PREV_USER, REPLY);
    const mem = await (await getLocalDb()).getAll('aiChatMemory');
    expect(mem).toHaveLength(1);
    expect(mem[0]).toMatchObject({
      kind: 'conclusion', text: QUOTE, confirmedBy: 'button',
      sourceDialogueId: dlg.id, sourceMessageId: dlg.messages[1]!.id, sourceDocumentIds: ['uuid-1'],
    });
    // Мутация (кейс «сбой записи» ниже): не бросать при 'failed' — красный.
  });

  it('сбой записи → тост ошибки, не успеха; сбой модели — тоже ошибка', async () => {
    const write = vi.spyOn(AIChatMemoryService, 'addConclusion').mockResolvedValue('failed');
    const { result } = renderHook(() => useSaveInsight(dlg), { wrapper });
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => { result.current.handleSaveInsight(1); });
    await waitFor(() => expect(toastSpy.show).toHaveBeenCalledWith('Что-то пошло не так. Попробуй ещё раз.', 'error'));
    expect(toastSpy.show).not.toHaveBeenCalledWith('Вывод сохранён', 'success');
    expect(write).toHaveBeenCalled();
    // Мутация: убрать бросок при res==='failed' (вернуть 'failed' как итог) — красный.
    write.mockRestore();
    vi.mocked(AIService.pickInsight).mockResolvedValue({ ok: false, error: 'AI_UNAVAILABLE' });
    toastSpy.show.mockClear();
    act(() => { result.current.handleSaveInsight(1); });
    await waitFor(() => expect(toastSpy.show).toHaveBeenCalledWith('Что-то пошло не так. Попробуй ещё раз.', 'error'));
    expect(toastSpy.show).not.toHaveBeenCalledWith('Вывод сохранён', 'success');
  });

  it('quote:null → записи нет, тост «не нашлось»; повтор — «уже сохранён», запись одна', async () => {
    vi.mocked(AIService.pickInsight).mockResolvedValue({ ok: true, quote: null });
    const { result } = renderHook(() => useSaveInsight(dlg), { wrapper });
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => { result.current.handleSaveInsight(1); });
    await waitFor(() => expect(toastSpy.show).toHaveBeenCalledWith('В этом ответе не нашлось вывода о тебе', 'info'));
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(0);
    // Мутация: при quote:null сохранять весь ответ целиком — красный.
    vi.mocked(AIService.pickInsight).mockResolvedValue({ ok: true, quote: QUOTE });
    act(() => { result.current.handleSaveInsight(1); });
    await waitFor(() => expect(toastSpy.show).toHaveBeenCalledWith('Вывод сохранён', 'success'));
    toastSpy.show.mockClear();
    act(() => { result.current.handleSaveInsight(1); });
    await waitFor(() => expect(toastSpy.show).toHaveBeenCalledWith('Этот вывод уже сохранён', 'info'));
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(1);
  });

  it('флаг выключен или персона-редактор → кнопки нет; с флагом и коучем — есть', async () => {
    vi.mocked(chatInsightsEnabled).mockResolvedValue(false);
    const off = renderHook(() => useSaveInsight(dlg), { wrapper });
    await waitFor(() => expect(off.result.current.visible).toBe(false));
    // Мутация: убрать условие флага в visible — красный.
    vi.mocked(chatInsightsEnabled).mockResolvedValue(true);
    const editor = renderHook(() => useSaveInsight({ ...dlg, personaId: 'editor' }), { wrapper });
    await waitFor(() => expect(editor.result.current.visible).toBe(false));
    const on = renderHook(() => useSaveInsight(dlg), { wrapper });
    await waitFor(() => expect(on.result.current.visible).toBe(true));
    const { unmount } = render(
      <AssistantTurn name="Коуч" color="#8a83e8" mono="К" onSaveInsight={() => {}}>synthetic reply</AssistantTurn>,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: 'Сохранить вывод' })).toBeTruthy();
    unmount();
    render(<AssistantTurn name="Коуч" color="#8a83e8" mono="K">synthetic reply</AssistantTurn>, { wrapper });
    expect(screen.queryByRole('button', { name: 'Сохранить вывод' })).toBeNull();
  });

  it('двойной клик → один вызов модели и одна запись', async () => {
    const { result } = renderHook(() => useSaveInsight(dlg), { wrapper });
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => {
      result.current.handleSaveInsight(1);
      result.current.handleSaveInsight(1);
    });
    await waitFor(() => expect(toastSpy.show).toHaveBeenCalledWith('Вывод сохранён', 'success'));
    expect(AIService.pickInsight).toHaveBeenCalledTimes(1);
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(1);
    // Мутация: убрать защиту execute от параллельного вызова (useServiceAction) — красный.
  });

  // Ревью 0.11.24, I-2: ответ о заметке, скрытой от ИИ, модели не уходит — кнопка
  // отвечает «вывода нет». Мутация: убрать проверку citesAnyId(reply…) — pickInsight
  // зовётся, красный.
  it('ответ о скрытой заметке: модель не зовётся, ничего не пишется', async () => {
    const db = await getLocalDb();
    const doc = await db.get('documents', 'doc_1');
    await db.put('documents', { ...doc!, excludedFromAI: true });
    const { result } = renderHook(() => useSaveInsight(dlg), { wrapper });
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => { result.current.handleSaveInsight(1); });
    await waitFor(() => expect(toastSpy.show).toHaveBeenCalledWith(expect.any(String), 'info'));
    expect(AIService.pickInsight).not.toHaveBeenCalled();
    expect(await db.getAll('aiChatMemory')).toHaveLength(0);
  });

  // I-1: реплика с приложенной заметкой — модели и в память без тела, заметка в источниках.
  // Мутация: pickInsight(prevUser.content, …) вместо prevUserApi — тело в вызове, красный.
  it('реплика с приложенной заметкой: без тела модели и в память, заметка — источник', async () => {
    const BODY = 'Синтетическое тело приложенной заметки про вечер.';
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'doc_att', uuid: 'uuid-att', title: 'Вечер', guestId: 'u_di5',
      currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 0,
      firstSessionAt: 1, lastSessionAt: 1, tags: [],
    });
    const prevUser = attachedTurn([{ documentId: 'doc_att', title: 'Вечер', content: BODY, lastSessionAt: 0 }], 'почему так?');
    const created = await AIDialogueService.create({
      title: 'Синтетический разговор 2', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🧭',
      messages: [
        { role: 'user', content: prevUser, type: 'chat' },
        { role: 'assistant', content: REPLY, type: 'chat' },
      ],
    });
    const d2 = (await AIDialogueService.get(created.id))!;
    const { result } = renderHook(() => useSaveInsight(d2), { wrapper });
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => { result.current.handleSaveInsight(1); });
    await waitFor(() => expect(toastSpy.show).toHaveBeenCalledWith('Вывод сохранён', 'success'));
    const [userArg] = vi.mocked(AIService.pickInsight).mock.calls[0]!;
    expect(userArg).not.toContain(BODY);
    expect(userArg).toContain('почему так?');
    const mem = await db.getAll('aiChatMemory');
    expect(mem[0]?.context ?? '').not.toContain(BODY);
    expect(mem[0]?.sourceDocumentIds).toEqual(expect.arrayContaining(['uuid-1', 'uuid-att']));
  });
});
