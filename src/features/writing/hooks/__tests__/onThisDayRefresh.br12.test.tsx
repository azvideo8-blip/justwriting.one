// BR-12 (ревью 25.10, RA1-7): тесты карточки «В этот день» на главном.
// 1) перечитка: раньше событие было одно — `note.saved`; заметку убрали в
//    корзину или скрыли в другой вкладке, и карточка продолжала её показывать
//    до следующего сохранения;
// 2) закрытие «на сегодня»: проверка `dismissedDay === today` не тестировалась
//    вовсе, а `not.toBe('2026-10-25')` не могло покраснеть.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act, render, screen } from '@testing-library/react';
import { format, subDays, subYears } from 'date-fns';
import React from 'react';

const docs: Record<string, unknown>[] = [];
// `t` — стабильная ссылка: она в зависимостях эффекта загрузки. С новой
// функцией на каждый рендер эффект перезапускался бы сам, и проверка
// «перечитка по событию» стала бы пустой.
const translate = vi.hoisted(() => (k: string) => k);
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { getDocumentsByOwner: async () => docs },
}));
vi.mock('../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: { getLatestContent: async () => 'текст воспоминания' },
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: translate, tp: translate, language: 'ru' }),
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'desktop' }),
}));

import { useOnThisDayHome } from '../useOnThisDayHome';
import { OnThisDayCard, onThisDayDismissKey, writeDismissedDay } from '../../../../core/components/OnThisDayCard';
import { emitDomainEvent } from '../../../../core/events/domainEvents';
import type { ArchiveSession } from '../../../../shared/types/common';

const UID = 'u_br12';
const YEAR_AGO = subYears(new Date(), 1);

function doc(id: string, at: number, extra: Record<string, unknown> = {}) {
  return {
    id, guestId: UID, title: `Заголовок ${id}`, currentVersion: 1, totalWords: 10,
    totalDuration: 60, sessionsCount: 1, firstSessionAt: at, lastSessionAt: at, tags: [], ...extra,
  };
}

function cardSession(id: string): ArchiveSession {
  return {
    id, userId: UID, content: 'текст', duration: 60, wordCount: 10, charCount: 50, wpm: 5,
    title: `Заголовок ${id}`, tags: [], createdAt: YEAR_AGO, sessionStartTime: YEAR_AGO.getTime(), _isLocal: true,
  };
}

beforeEach(() => {
  docs.length = 0;
  localStorage.clear();
});

describe('BR-12: карточка замечает корзину и скрытие без нового сохранения', () => {
  it('заметку убрали в корзину — карточка уходит', async () => {
    docs.push(doc('mem', YEAR_AGO.getTime()));
    const { result } = renderHook(() => useOnThisDayHome(UID, true));
    await waitFor(() => expect(result.current?.id).toBe('mem'));

    act(() => { emitDomainEvent({ type: 'note.trashed', documentId: 'mem' }); });
    // Другая вкладка не шлёт событий этой — возвращение вкладки тоже повод
    // перечитать.
    docs[0]!.trashedAt = Date.now();
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() => expect(result.current).toBeNull());
  });

  it('заметку скрыли от ИИ — карточка уходит', async () => {
    docs.push(doc('mem2', YEAR_AGO.getTime()));
    const { result } = renderHook(() => useOnThisDayHome(UID, true));
    await waitFor(() => expect(result.current?.id).toBe('mem2'));

    act(() => {
      docs[0]!.excludedFromAI = true;
      emitDomainEvent({ type: 'note.excludedFromAI', documentId: 'mem2', excluded: true });
    });

    await waitFor(() => expect(result.current).toBeNull());
  });

  it('возврат вкладки перечитывает карточку (правку сделали в другой вкладке)', async () => {
    docs.push(doc('mem3', YEAR_AGO.getTime()));
    const { result } = renderHook(() => useOnThisDayHome(UID, true));
    await waitFor(() => expect(result.current?.id).toBe('mem3'));

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    docs.length = 0;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() => expect(result.current).toBeNull());
  });
});

describe('BR-12: закрытие «на сегодня» — сравнение с сегодняшней датой', () => {
  it('закрыто сегодня — карточки нет', () => {
    writeDismissedDay(UID, format(new Date(), 'yyyy-MM-dd'));
    render(<OnThisDayCard sessions={[cardSession('mem')]} onOpen={vi.fn()} userId={UID} />);
    expect(screen.queryByText('Заголовок mem')).toBeNull();
  });

  it('закрыто вчера — карточка снова есть', () => {
    localStorage.setItem(onThisDayDismissKey(UID), format(subDays(new Date(), 1), 'yyyy-MM-dd'));
    render(<OnThisDayCard sessions={[cardSession('mem')]} onOpen={vi.fn()} userId={UID} />);
    expect(screen.getByText('Заголовок mem')).toBeInTheDocument();
  });
});
