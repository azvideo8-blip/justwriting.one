// DI-6: раздел «Выводы из разговоров» — сбой чтения не «пусто», удаление только
// после успеха, ссылка только в живой разговор, пусто+флаг выключен — раздела нет.
// Настоящие DialogueInsights / AIChatMemoryService / AIDialogueService поверх
// fake-indexeddb; подменены край базы (сбой чтения/удаления), флаг, тосты,
// подтверждение и reportError. Мутации — в комментариях у кейсов.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import 'fake-indexeddb/auto';

const failRead = vi.hoisted(() => ({ on: false }));
vi.mock('@/core/storage/localDb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/storage/localDb')>();
  return {
    ...actual,
    getLocalDb: async (uid?: string) => {
      if (failRead.on) throw new Error('MARKER_IDB_DOWN');
      return actual.getLocalDb(uid);
    },
  };
});
const h = vi.hoisted(() => ({ show: vi.fn(), confirm: vi.fn(), authCbs: [] as ((u: { uid: string } | null) => void)[] }));
vi.mock('@/shared/components/Toast', () => ({ useToast: () => ({ showToast: h.show }) }));
vi.mock('@/shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: h.confirm }) }));
vi.mock('@/core/sync/syncFlags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/sync/syncFlags')>();
  return { ...actual, chatInsightsEnabled: vi.fn() };
});
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/core/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/auth')>();
  return {
    ...actual,
    getCurrentUser: () => null,
    onAuthStateChange: (cb: (u: { uid: string } | null) => void) => { h.authCbs.push(cb); return () => {}; },
  };
});

import { DialogueInsights } from '@/features/ai/components/DialogueInsights';
import { AIChatMemoryService } from '@/features/ai/services/AIChatMemoryService';
import { AIDialogueService } from '@/features/ai/services/AIDialogueService';
import { chatInsightsEnabled } from '@/core/sync/syncFlags';
import { LocalStoreSyncService } from '@/core/services/LocalStoreSyncService';
import { getLocalDb } from '@/core/storage/localDb';
import { renderWithProviders } from '@/test/utils/render';

const QUOTE_A = 'Ты ждёшь разрешения на своё, и потому всё откладываешь.';
const QUOTE_B = 'Своё ты ставишь в конец очереди, а очередь не кончается.';
const QUOTE_C = 'Отдых для тебя — награда, а не часть работы.';
const EMPTY_TEXT = 'Когда в разговоре прозвучит вывод и ты с ним согласишься, он появится здесь';

let liveId = '';
let archivedId = '';
let deletedId = '';

function renderInsights() {
  return renderWithProviders(
    <MemoryRouter>
      <DialogueInsights section={c => <div data-testid="sec">{c}</div>} />
    </MemoryRouter>,
  );
}

async function seed() {
  const mk = async (title: string) => (await AIDialogueService.create({
    title, personaId: 'coach', personaName: 'Коуч', personaEmoji: '🧭', messages: [],
  })).id;
  liveId = await mk('Синтетический живой');
  archivedId = await mk('Синтетический архивный');
  await AIDialogueService.archive(archivedId);
  deletedId = await mk('Синтетический удалённый');
  await AIDialogueService.delete(deletedId);
  await AIChatMemoryService.addConclusion({ text: QUOTE_A, context: 'реплика', dialogueId: liveId, messageId: 'm1', sourceDocumentIds: [], confirmedBy: 'reply' });
  await AIChatMemoryService.addConclusion({ text: QUOTE_B, context: 'реплика', dialogueId: deletedId, messageId: 'm2', sourceDocumentIds: [], confirmedBy: 'button' });
  await AIChatMemoryService.addConclusion({ text: QUOTE_C, context: 'реплика', dialogueId: archivedId, messageId: 'm3', sourceDocumentIds: [], confirmedBy: 'reply' });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  cleanup();
  failRead.on = false;
  h.authCbs.length = 0;
  localStorage.setItem('language', 'ru');
  h.confirm.mockResolvedValue(true);
  vi.mocked(chatInsightsEnabled).mockResolvedValue(true);
  vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});
  vi.spyOn(LocalStoreSyncService, 'scheduleStoreDelete').mockImplementation(() => {});
  const db = await getLocalDb();
  await db.clear('aiChatMemory');
  await db.clear('aiDialogues');
  await seed();
});

describe('DI-6: DialogueInsights', () => {
  it('строки: текст в ёлочках, подписи, ссылка только в живой и архивный разговор', async () => {
    renderInsights();
    await waitFor(() => expect(screen.getByText(`«${QUOTE_A}»`)).toBeTruthy());
    expect(screen.getByText(`«${QUOTE_B}»`)).toBeTruthy();
    expect(screen.getAllByText('подтверждено тобой')).toHaveLength(2);
    expect(screen.getByText('сохранено тобой')).toBeTruthy();
    // Живой и архивный — ссылка есть, удалённый — нет.
    expect(screen.getAllByRole('button', { name: 'Открыть разговор' })).toHaveLength(2);
    // Мутация: показывать ссылку всегда — красный (стало бы 3).
  });

  it('сбой чтения → LoadNotice с «Повторить», не «пусто»; повтор читает', async () => {
    failRead.on = true;
    renderInsights();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
    // Мутация: catch → пустой settled — красный.
    failRead.on = false;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByText(`«${QUOTE_A}»`)).toBeTruthy());
  });

  it('сбой удаления → строка на месте и тост ошибки', async () => {
    const db = await getLocalDb();
    const orig = db.delete.bind(db) as (store: string, key: string | number) => Promise<void>;
    (db as unknown as { delete: (store: string, key: string | number) => Promise<void> }).delete =
      (store, key) => store === 'aiChatMemory' ? Promise.reject(new Error('MARKER_DELETE_DOWN')) : orig(store, key);
    renderInsights();
    await waitFor(() => expect(screen.getByText(`«${QUOTE_A}»`)).toBeTruthy());
    const rowA = screen.getByText(`«${QUOTE_A}»`).closest('[data-testid^="insight-row-"]') as HTMLElement;
    fireEvent.click(within(rowA).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(h.show).toHaveBeenCalledWith('Что-то пошло не так. Попробуй ещё раз.', 'error'));
    expect(screen.getByText(`«${QUOTE_A}»`)).toBeTruthy();
    // Мутация: убрать строку до await delete — красный.
    // Экземпляр базы кэшируется — подмену снимаем, иначе она течёт в соседние кейсы.
    (db as unknown as { delete: (store: string, key: string | number) => Promise<void> }).delete = orig;
  });

  it('удаление: отмена подтверждения — строка остаётся; успех — строка уходит', async () => {
    renderInsights();
    await waitFor(() => expect(screen.getByText(`«${QUOTE_A}»`)).toBeTruthy());
    const rowA = screen.getByText(`«${QUOTE_A}»`).closest('[data-testid^="insight-row-"]') as HTMLElement;
    h.confirm.mockResolvedValueOnce(false);
    fireEvent.click(within(rowA).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(h.confirm).toHaveBeenCalled());
    expect(screen.getByText(`«${QUOTE_A}»`)).toBeTruthy();
    const rowAgain = screen.getByText(`«${QUOTE_A}»`).closest('[data-testid^="insight-row-"]') as HTMLElement;
    fireEvent.click(within(rowAgain).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(screen.queryByText(`«${QUOTE_A}»`)).toBeNull());
    expect(screen.getByText(`«${QUOTE_B}»`)).toBeTruthy();
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(2);
  });

  // Ревью 0.11.24, Nit 1: флаг выключен — сбой чтения тоже не показывает раздел
  // (профиль как в 0.11.23). Мутация: скрывать только empty — alert виден, красный.
  it('сбой чтения и флаг выключен — раздела нет', async () => {
    failRead.on = true;
    vi.mocked(chatInsightsEnabled).mockResolvedValue(false);
    renderInsights();
    await waitFor(() => expect(chatInsightsEnabled).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('sec')).toBeNull();
  });

  it('пусто и флаг выключен — раздела нет; пусто и флаг включён — пояснение; выводы есть — раздел и при выключенном флаге', async () => {
    await (await getLocalDb()).clear('aiChatMemory');
    vi.mocked(chatInsightsEnabled).mockResolvedValue(false);
    const off = renderInsights();
    await waitFor(() => expect(chatInsightsEnabled).toHaveBeenCalled());
    expect(screen.queryByTestId('sec')).toBeNull();
    off.unmount();
    vi.mocked(chatInsightsEnabled).mockResolvedValue(true);
    const on = renderInsights();
    await waitFor(() => expect(screen.getByText(EMPTY_TEXT)).toBeTruthy());
    on.unmount();
    await seed();
    vi.mocked(chatInsightsEnabled).mockResolvedValue(false);
    renderInsights();
    await waitFor(() => expect(screen.getByText(`«${QUOTE_A}»`)).toBeTruthy());
    // Мутация: скрывать раздел при выключенном флаге всегда — красный.
  });
  it('uid пришёл после монтирования: флаг перечитан, пусто+флаг — раздел виден', async () => {
    const db = await getLocalDb();
    await db.clear('aiChatMemory');
    vi.mocked(chatInsightsEnabled).mockImplementation(async (uid?: string) => uid === 'u_late');
    renderInsights();
    await waitFor(() => expect(vi.mocked(chatInsightsEnabled)).toHaveBeenCalled());
    expect(screen.queryByTestId('sec')).toBeNull();
    act(() => { for (const cb of h.authCbs) cb({ uid: 'u_late' }); });
    await waitFor(() => expect(screen.getByText(EMPTY_TEXT)).toBeTruthy());
    // Мутация: разовый запрос флага при монтировании без подписки на uid — красный.
  });

});
