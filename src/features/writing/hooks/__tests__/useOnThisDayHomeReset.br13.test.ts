// BR-13 (ревью 25.10): перенос карточки в `core/components` (коммит `5dee0039`,
// «перенос», который не должен был менять поведение) заодно убрал сброс
// результата: эффект грузит только при `enabled && userId`, а `match` после
// этого остаётся прежним. Значит при `userId = ''` и во время загрузки другого
// человека главный показывает находку прежнего.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { subYears } from 'date-fns';

const store = vi.hoisted(() => ({
  docs: [] as Record<string, unknown>[],
  delayMs: 0,
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    getDocumentsByOwner: async () => {
      if (store.delayMs > 0) await new Promise(r => setTimeout(r, store.delayMs));
      return store.docs;
    },
  },
}));
vi.mock('../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: { getLatestContent: async () => 'текст' },
}));
const translate = vi.hoisted(() => (k: string) => k);
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: translate, tp: translate, language: 'ru' }),
}));

import { useOnThisDayHome } from '../useOnThisDayHome';

function doc(id: string, at: number) {
  return {
    id, guestId: 'u1', title: `Заголовок ${id}`, currentVersion: 1, totalWords: 10,
    totalDuration: 60, sessionsCount: 1, firstSessionAt: at, lastSessionAt: at, tags: [],
  };
}

const MEM_FIRST = 'mem_first';
const MEM_SECOND = 'mem_second';

beforeEach(() => {
  store.docs = [doc(MEM_FIRST, subYears(new Date(), 1).getTime())];
  store.delayMs = 0;
});

describe('BR-13: хук «В этот день» сбрасывает результат', () => {
  it('владельца убрали (`userId = ""`) — находка прежнего не остаётся', async () => {
    let uid = 'u_br13_first';
    const { result, rerender } = renderHook(() => useOnThisDayHome(uid, true));
    await waitFor(() => expect(result.current?.id).toBe(MEM_FIRST));

    uid = '';
    rerender();

    expect(result.current, 'при пустом владельце показана находка прежнего').toBeNull();
  });

  it('пока новый человек читается — карточка прежнего не показывается', async () => {
    let uid = 'u_br13_first';
    const { result, rerender } = renderHook(() => useOnThisDayHome(uid, true));
    await waitFor(() => expect(result.current?.id).toBe(MEM_FIRST));

    uid = 'u_br13_second';
    store.docs = [doc(MEM_SECOND, subYears(new Date(), 1).getTime())];
    store.delayMs = 40;
    rerender();

    expect(result.current, 'находка прежнего видна, пока читается новый').toBeNull();
    await waitFor(() => expect(result.current?.id).toBe(MEM_SECOND));
  });
});
