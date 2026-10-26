// BR-7 (ревью 25.10, предложение ревьюера — решение ещё за владельцем):
// «В этот день» на компьютере показывает название + 120 знаков текста заметки,
// а на телефоне — только название. Довод владельца по RA1-3: экран может быть
// открыт при ком-то. Домашний вариант карточки — строка без текста; в архиве
// выдержка остаётся (RC-6).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { subYears } from 'date-fns';
import { renderWithProviders } from '../../../../test/utils/render';
import { OnThisDayCard } from '../../../../core/components/OnThisDayCard';
import type { ArchiveSession } from '../../../archive/types';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'desktop' }),
}));

const oneYearAgo = subYears(new Date(), 1).getTime();
const NOTE_TEXT = 'Разговор с отцом, который я три недели не мог начать.';

function session(overrides: Partial<ArchiveSession> = {}): ArchiveSession {
  return {
    id: 'session_br7',
    userId: 'u1',
    title: 'Год назад',
    content: NOTE_TEXT,
    createdAt: oneYearAgo,
    duration: 120,
    wordCount: 8,
    charCount: 50,
    wpm: 4,
    tags: [],
    _isLocal: true,
    ...overrides,
  };
}

beforeEach(() => { localStorage.clear(); });

describe('BR-7: домашняя карточка «В этот день» — только название', () => {
  it('домашний вариант: название есть, текста заметки нет', () => {
    renderWithProviders(<OnThisDayCard sessions={[session()]} onOpen={vi.fn()} showExcerpt={false} />);
    expect(screen.getByText('Год назад')).toBeInTheDocument();
    expect(screen.queryByText(NOTE_TEXT), 'на компьютере показан текст заметки').toBeNull();
  });

  it('архивный вариант: выдержка остаётся (RC-6 не сломан)', () => {
    renderWithProviders(<OnThisDayCard sessions={[session()]} onOpen={vi.fn()} />);
    expect(screen.getByText(NOTE_TEXT)).toBeInTheDocument();
  });
});
