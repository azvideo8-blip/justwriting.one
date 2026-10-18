// B-2 (0.10.2): эффект useCitationMeta перезапускался на каждый кусок потока и
// делал db.getAll('documents') на каждый ненайденный id — при промахе id не
// кешировался, и база перечитывалась каждый рендер. Плюс при нескольких копиях
// с одним ключом мог открыться экземпляр из корзины.
// Теперь: один getAll за проход, карта по id/uuid/linkedCloudId, промах
// помнится, живая копия важнее корзины.
// Мутации: вернуть getAll на каждый id → кейс 1; убрать кеш промаха → кейс 2;
// убрать приоритет живой копии → кейс 3.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_b2' }), getCurrentUserId: () => 'u_b2' }));
vi.mock('../../../../../core/services/LocalVersionService', () => ({ LocalVersionService: { getLatestContent: async () => 'Текст.' } }));

// Фейковая база вместо IndexedDB: idb-прокси не даёт навесить шпион на
// экземпляр, а нам важно ровно число вызовов getAll за проход.
const state = vi.hoisted(() => ({ getAll: null as unknown as ReturnType<typeof vi.fn>, docs: [] as unknown[] }));
state.getAll = vi.fn(async () => state.docs);
vi.mock('../../../../../core/storage/localDb', () => ({
  getLocalDb: async () => ({ getAll: state.getAll }),
}));

const { useCitationMeta } = await import('../useCitationMeta');

describe('B-2: кеширование цитат в useCitationMeta', () => {
  beforeEach(() => {
    state.getAll = vi.fn(async () => state.docs);
    state.docs = [
      // Копия в корзине намеренно первой: прежний all.find возвращал именно её.
      { id: 'local_a_trashed', uuid: 'uuid-trash', linkedCloudId: 'cloud-copy', guestId: 'u_b2', title: 'Корзина', trashedAt: 123, lastSessionAt: 1 },
      { id: 'local_b_live', uuid: 'uuid-live', linkedCloudId: 'cloud-copy', guestId: 'u_b2', title: 'Живая', lastSessionAt: 1 },
    ];
  });

  it('два прохода с неизвестным id — ровно один getAll', async () => {
    const msg = [{ role: 'assistant', content: 'Ответ [#missing-note-000123] и ещё [#missing-note-000123].' }];
    const initial: { messages: unknown[]; stream: string | null } = { messages: msg, stream: null };
    const { rerender } = renderHook(
      ({ messages, stream }) =>
        useCitationMeta(messages as never, stream, vi.fn(), vi.fn()),
      { initialProps: initial },
    );
    await waitFor(() => expect(state.getAll).toHaveBeenCalled());
    const afterFirst = state.getAll.mock.calls.length;
    expect(afterFirst, 'один проход не должен читать базу по раза на id').toBe(1);

    // Следующий кусок потока с тем же неизвестным id: эффект перезапускается,
    // но промах уже в кеше — нового getAll быть не должно.
    rerender({ messages: msg, stream: 'дописываю [#missing-note-000123]' });
    await new Promise(r => setTimeout(r, 20));
    rerender({ messages: msg, stream: 'ещё кусок [#missing-note-000123]' });
    await new Promise(r => setTimeout(r, 20));
    expect(state.getAll.mock.calls.length, 'промах не закеширован — база перечитана').toBe(afterFirst);
  });

  it('несколько неизвестных id за проход — всё равно один getAll', async () => {
    const msg = [{ role: 'assistant', content: '[#aaa-unknown-0001] [#bbb-unknown-0002]' }];
    renderHook(() => useCitationMeta(msg as never, null, vi.fn(), vi.fn()));
    await waitFor(() => expect(state.getAll).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 20));
    expect(state.getAll.mock.calls.length).toBe(1);
  });

  it('промах кешируется, ссылка остаётся кликабельной без даты', async () => {
    const msg = [{ role: 'assistant', content: '[#ghost-note-0009]' }];
    const { result } = renderHook(() => useCitationMeta(msg as never, null, vi.fn(), vi.fn()));
    await waitFor(() => expect(state.getAll).toHaveBeenCalled());
    expect(result.current.processCitations('[#ghost-note-0009]')).toBe('[📅](#cite-ghost-note-0009)');
  });

  it('при двух копиях с одним ключом открывается живая, а не из корзины', async () => {
    const setPreview = vi.fn();
    const { result } = renderHook(() => useCitationMeta([], null, setPreview, vi.fn()));
    result.current.handleCitationClick('cloud-copy');
    await waitFor(() => expect(setPreview).toHaveBeenCalled());
    const first = setPreview.mock.calls[0]?.[0];
    expect(first).toEqual(expect.objectContaining({ id: 'local_b_live', title: 'Живая' }));
    expect(first).not.toHaveProperty('id', 'local_a_trashed');
  });
});
