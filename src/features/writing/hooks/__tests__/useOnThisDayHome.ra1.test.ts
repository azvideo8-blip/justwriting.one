// RA1-7: данные карточки на главном. Запись год назад (в окне ±1 день)
// превращается в карточку, корзина и скрытые от ИИ — нет.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { subDays, subYears } from 'date-fns';

const docs: Record<string, unknown>[] = [];
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { getDocumentsByOwner: async () => docs },
}));
vi.mock('../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: { getLatestContent: async () => 'текст воспоминания' },
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));

import { useOnThisDayHome } from '../useOnThisDayHome';

function doc(id: string, at: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    guestId: 'u1',
    title: `Заголовок ${id}`,
    currentVersion: 1,
    totalWords: 10,
    totalDuration: 60,
    sessionsCount: 1,
    firstSessionAt: at,
    lastSessionAt: at,
    tags: [],
    ...extra,
  };
}

describe('RA1-7: карточка «В этот день» на главном', () => {
  beforeEach(() => {
    docs.length = 0;
  });

  it('запись год назад ±1 день → карточка с текстом', async () => {
    const at = subDays(subYears(new Date(), 1), 1).getTime();
    docs.push(doc('year_ago', at));

    const { result } = renderHook(() => useOnThisDayHome('u1', true));
    await waitFor(() => expect(result.current?.id).toBe('year_ago'));
    expect(result.current?.content).toBe('текст воспоминания');
  });

  it('корзина не вспоминается', async () => {
    const at = subYears(new Date(), 1).getTime();
    docs.push(doc('trashed', at, { trashedAt: Date.now() }));

    const { result } = renderHook(() => useOnThisDayHome('u1', true));
    await new Promise(r => setTimeout(r, 20));
    expect(result.current).toBeNull();
  });

  it('скрытая от ИИ не показывается вовсе', async () => {
    const at = subYears(new Date(), 1).getTime();
    docs.push(doc('hidden', at, { excludedFromAI: true }));

    const { result } = renderHook(() => useOnThisDayHome('u1', true));
    await new Promise(r => setTimeout(r, 20));
    expect(result.current).toBeNull();
  });

  it('года назад записи нет — карточки нет', async () => {
    docs.push(doc('recent', Date.now()));
    const { result } = renderHook(() => useOnThisDayHome('u1', true));
    await new Promise(r => setTimeout(r, 20));
    expect(result.current).toBeNull();
  });
});
