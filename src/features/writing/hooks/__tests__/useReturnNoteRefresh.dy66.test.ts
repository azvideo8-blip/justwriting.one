import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { subDays } from 'date-fns';

// DY6-6 (приёмка 26.10, Н-4): `useReturnNote` перечитывал карточку «Продолжить»
// только по `note.saved`. Удаление/корзина/скрытие из другого места (архив,
// «Моя жизнь», карточка в меню заметки) оставляли карточку висеть до следующего
// сохранения. Образец — `useOnThisDayHome` (BR-12): те же четыре события и
// возврат вкладки.

import { useReturnNote } from '../useReturnNote';
import { emitDomainEvent } from '../../../../core/events/domainEvents';

const store = vi.hoisted(() => ({
  byOwner: {} as Record<string, unknown[]>,
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    getDocumentsByOwner: async (uid: string) => store.byOwner[uid] ?? [],
  },
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const U = 'u_dy66';
const NOTE = 'note_dy66';

function doc(id: string, daysAgo: number) {
  const at = subDays(new Date(), daysAgo).getTime();
  return {
    id, guestId: U, title: `Заголовок ${id}`, currentVersion: 1, totalWords: 10,
    totalDuration: 60, sessionsCount: 1, firstSessionAt: at, lastSessionAt: at, tags: [],
  };
}

beforeEach(() => {
  store.byOwner = { [U]: [doc(NOTE, 3)] };
});

describe('DY6-6: «Продолжить» перечитывается на те же события, что «В этот день»', () => {
  it.each(['note.deleted', 'note.trashed', 'note.excludedFromAI'] as const)('%s: карточка исчезает без сохранения', async (type) => {
    const { result } = renderHook(() => useReturnNote(U));
    await waitFor(() => expect(result.current?.localId).toBe(NOTE));

    // реальное удаление/корзина/скрытие убирает строку из выдачи getDocumentsByOwner
    store.byOwner[U] = [];
    await act(async () => {
      emitDomainEvent({ type, documentId: NOTE } as never);
    });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('note.saved по-прежнему перечитывает (регресс BR-12-наоборот)', async () => {
    const { result } = renderHook(() => useReturnNote(U));
    await waitFor(() => expect(result.current?.localId).toBe(NOTE));

    const NEWER = 'note_dy66_new';
    store.byOwner[U] = [doc(NOTE, 3), doc(NEWER, 2)];
    await act(async () => {
      emitDomainEvent({ type: 'note.saved', documentId: NEWER } as never);
    });
    await waitFor(() => expect(result.current?.localId).toBe(NEWER));
  });

  it('возврат вкладки перечитывает карточку', async () => {
    const { result } = renderHook(() => useReturnNote(U));
    await waitFor(() => expect(result.current?.localId).toBe(NOTE));

    store.byOwner[U] = [];
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(result.current).toBeNull());
  });
});
