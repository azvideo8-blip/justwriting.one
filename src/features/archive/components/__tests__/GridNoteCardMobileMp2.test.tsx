// MP-2: карточка сетки на телефоне — только текст. Даты, относительного времени,
// чипсов тегов, счётчиков и иконок нет; тап открывает читалку, долгое нажатие
// ведёт в лист действий и заметку не открывает. Десктопная карточка не изменилась.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, act, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { GridNoteCard } from '../GridNoteCard';
import { ArchiveSession } from '../../types';
import { Label } from '../../../../types';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ prompt: vi.fn().mockResolvedValue(null), confirm: vi.fn(), alert: vi.fn() }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ profile: null, user: null }),
}));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));

const labels: Label[] = [{ id: 'lbl_1', name: 'Работа', color: '#e0a458' }];

function sessionOf(extra: Partial<ArchiveSession> = {}): ArchiveSession {
  return {
    id: 'doc_mp2',
    userId: 'u1',
    content: 'Глина сохнет быстрее, чем кажется. Поэтому круг крутят медленно.',
    duration: 300,
    wordCount: 42,
    sessionWordsAdded: 42,
    sittings: [],
    charCount: 64,
    wpm: 8,
    title: 'Про гончарный круг',
    tags: ['глина'],
    labelId: 'lbl_1',
    createdAt: new Date(2026, 9, 14, 9, 5),
    sessionStartTime: new Date(2026, 9, 14, 9, 5).getTime(),
    _isLocal: true,
    ...extra,
  };
}

function renderCard(session: ArchiveSession, extra: Record<string, unknown> = {}) {
  const onClick = vi.fn();
  const view = renderWithProviders(
    <GridNoteCard session={session} onClick={onClick} userId="user_1" labels={labels} allTags={['глина', 'семья']} {...extra} />,
  );
  return { ...view, onClick };
}

describe('MP-2: карточка сетки на телефоне', () => {
  beforeEach(() => {
    cleanup();
    layoutMode = 'mobile';
  });

  it('в карточке только заголовок и текст — ни даты, «назад», ни слов, ни иконок', () => {
    renderCard(sessionOf());
    expect(screen.getByText('Про гончарный круг')).toBeInTheDocument();
    expect(screen.getByText(/Глина сохнет быстрее/)).toBeInTheDocument();

    expect(screen.queryByText(/назад/), 'в карточке осталось относительное время').toBeNull();
    expect(screen.queryByText(/42 слов/), 'в карточке остались счётчики').toBeNull();
    expect(screen.queryByText(/14 окт|октября/), 'в карточке осталась дата').toBeNull();
    expect(screen.queryByText('#глина'), 'в карточке остался чипс тега').toBeNull();
    // Кнопок в мобильной карточке нет вовсе: «⋯» открывается долгим нажатием.
    expect(screen.queryAllByRole('button'), 'в карточке остался ряд иконок').toHaveLength(0);
  });

  it('текст карточки не растёт бесконечно: 6 строк максимум, цель касания ≥ 44 px', () => {
    const { container } = renderCard(sessionOf({ content: 'Раз. Два. Три. Четыре. Пять. Шесть. Семь. Восемь. Девять.' }));
    const card = container.firstChild as HTMLElement;
    expect(card.className, 'карточка не тянется на всю строку').toContain('h-full');
    expect(card.className, 'у карточки нет минимальной цели касания').toContain('min-h-11');
    expect(screen.getByText(/Раз\. Два\./).className, 'текст не ограничен шестью строками').toContain('line-clamp-6');
  });

  it('тап открывает заметку', () => {
    const { onClick } = renderCard(sessionOf());
    fireEvent.click(screen.getByText('Про гончарный круг'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('долгое нажатие (500 мс) открывает лист действий и не открывает заметку', () => {
    const { onClick } = renderCard(sessionOf());
    vi.useFakeTimers();
    const title = screen.getByText('Про гончарный круг');
    act(() => { fireEvent.touchStart(title, { touches: [{ clientX: 8, clientY: 8 }] }); });
    act(() => { vi.advanceTimersByTime(600); });
    act(() => { fireEvent.touchEnd(title); });
    vi.useRealTimers();
    expect(onClick, 'долгое нажатие ещё и открыло заметку').not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Действия с заметкой' }), 'лист действий не открылся').toBeInTheDocument();
  });

  it('палец, удержанный меньше 500 мс, остаётся обычным тапом', () => {
    const { onClick } = renderCard(sessionOf());
    vi.useFakeTimers();
    const title = screen.getByText('Про гончарный круг');
    act(() => { fireEvent.touchStart(title, { touches: [{ clientX: 8, clientY: 8 }] }); });
    act(() => { vi.advanceTimersByTime(200); });
    act(() => { fireEvent.touchEnd(title); });
    vi.useRealTimers();
    fireEvent.click(title);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('клик после долгого нажатия проглатывается', () => {
    const { onClick } = renderCard(sessionOf());
    vi.useFakeTimers();
    const title = screen.getByText('Про гончарный круг');
    act(() => { fireEvent.touchStart(title, { touches: [{ clientX: 8, clientY: 8 }] }); });
    act(() => { vi.advanceTimersByTime(600); });
    act(() => { fireEvent.touchEnd(title); });
    vi.useRealTimers();
    fireEvent.click(title);
    expect(onClick, 'тот же палец открыл заметку поверх листа').not.toHaveBeenCalled();
  });
});

describe('MP-2: десктопная карточка не изменилась', () => {
  beforeEach(() => {
    cleanup();
    layoutMode = 'desktop';
  });

  it('дата, относительное время, счётчики, чипсы тегов и «⋯» на месте', () => {
    renderCard(sessionOf());
    expect(screen.getByText(/назад/)).toBeInTheDocument();
    expect(screen.getByText(/42 слов/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Действия с заметкой' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Добавить тег|\+/ })).toBeInTheDocument();
  });
});
