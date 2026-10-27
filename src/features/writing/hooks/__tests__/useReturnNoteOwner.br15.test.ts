import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { subDays } from 'date-fns';

// BR-15 (ревью выпуска 0.10.11): `useReturnNote` не ключует находку владельцем.
// Экран при гость → аккаунт НЕ перемонтируется: вход живёт модалкой поверх
// текущего экрана (AppShell.tsx:173, кнопки — Sidebar.tsx:372 и BottomNav.tsx:98),
// а перезагрузка по смене аккаунта бывает только при уходе вошедшего
// (supabaseAuthProvider.ts:84-86: `currentUser !== null && …`). Значит `userId`
// меняется у уже примонтированного хука, и прежняя карточка видна новому
// человеку, пока читается его.
import { useReturnNote } from '../useReturnNote';
import { emitDomainEvent } from '../../../../core/events/domainEvents';

const store = vi.hoisted(() => ({
  byOwner: {} as Record<string, unknown[]>,
  delayByOwner: {} as Record<string, number>,
  failFor: {} as Record<string, boolean>,
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    getDocumentsByOwner: async (uid: string) => {
      const delay = store.delayByOwner[uid] ?? 0;
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      if (store.failFor[uid]) throw new Error('IDB documents read error');
      return store.byOwner[uid] ?? [];
    },
  },
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const GUEST = 'guest_br15';
const ACCOUNT = 'u_br15_account';
const NOTE_GUEST = 'note_guest_br15';
const NOTE_ACCOUNT = 'note_account_br15';

function doc(id: string, daysAgo: number) {
  const at = subDays(new Date(), daysAgo).getTime();
  return {
    id, guestId: 'g', title: `Заголовок ${id}`, currentVersion: 1, totalWords: 10,
    totalDuration: 60, sessionsCount: 1, firstSessionAt: at, lastSessionAt: at, tags: [],
  };
}

beforeEach(() => {
  store.byOwner = { [GUEST]: [doc(NOTE_GUEST, 3)], [ACCOUNT]: [doc(NOTE_ACCOUNT, 5)] };
  store.delayByOwner = {};
  store.failFor = {};
});

describe('BR-15: карточка «Продолжить» принадлежит владельцу, который её получил', () => {
  it('гость → аккаунт: пока аккаунт читается, карточка гостя не показывается', async () => {
    let uid = GUEST;
    const { result, rerender } = renderHook(() => useReturnNote(uid));
    await waitFor(() => expect(result.current?.localId).toBe(NOTE_GUEST));

    uid = ACCOUNT;
    store.delayByOwner[ACCOUNT] = 40;
    rerender();

    expect(result.current, 'находка гостя видна аккаунту').toBeUndefined();
    await waitFor(() => expect(result.current?.localId).toBe(NOTE_ACCOUNT));
  });

  it('поздний ответ прежнего владельца не перезаписывает находку нового', async () => {
    let uid = GUEST;
    store.delayByOwner[GUEST] = 60;
    const { result, rerender } = renderHook(() => useReturnNote(uid));

    uid = ACCOUNT;
    rerender();
    await waitFor(() => expect(result.current?.localId).toBe(NOTE_ACCOUNT));

    // Гостевой ответ приходит позже аккаунтового: `mountedRef` к этому моменту
    // снова true, и без ключа владельца он ложится поверх чужой карточки.
    await act(async () => { await new Promise(r => setTimeout(r, 120)); });
    expect(result.current?.localId, 'поздний ответ гостя затёр находку аккаунта').toBe(NOTE_ACCOUNT);
  });

  it('сбой загрузки — карточки нет, а не прежняя', async () => {
    const { result } = renderHook(() => useReturnNote(GUEST));
    await waitFor(() => expect(result.current?.localId).toBe(NOTE_GUEST));

    store.failFor[GUEST] = true;
    act(() => { emitDomainEvent({ type: 'note.saved', documentId: 'other', userId: GUEST }); });

    await waitFor(() => expect(result.current).toBeNull());
  });

  it('контроль: одна загрузка отдаёт карточку, перечитка по `note.saved` — обновлённую', async () => {
    const { result } = renderHook(() => useReturnNote(GUEST));
    await waitFor(() => expect(result.current?.localId).toBe(NOTE_GUEST));

    store.byOwner[GUEST] = [doc('note_fresh_br15', 2)];
    act(() => { emitDomainEvent({ type: 'note.saved', documentId: 'note_fresh_br15', userId: GUEST }); });
    await waitFor(() => expect(result.current?.localId).toBe('note_fresh_br15'));
  });
});
