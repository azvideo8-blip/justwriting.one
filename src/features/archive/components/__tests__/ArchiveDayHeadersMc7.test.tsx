// MC-7: «В этот день» — обычная строка-кнопка без цветного левого края, счётчики
// дня в листе «Календарь и статистика». ЗАГОЛОВКИ ДНЕЙ с 2026-10-18 больше не
// плоские строки словами: решение владельца по Q-2 (пункт U-14) — телефон
// приводит к десктопу (моноширинный капс, счётчики «N заметок · M слов», видимые
// линии), кегль подписи на телефоне не мельче 12 px (U-9). Десктопные заголовки
// не меняются.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { format, subDays, subMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import { renderWithProviders } from '../../../../test/utils/render';
import { ArchiveNoteList } from '../ArchiveNoteList';
import { OnThisDayCard } from '../../../../core/components/OnThisDayCard';
import type { ArchiveSession } from '../../types';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ prompt: vi.fn().mockResolvedValue(null), confirm: vi.fn(), alert: vi.fn() }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ profile: null, user: null }) }));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));
vi.mock('../../../../shared/i18n', async () => {
  const actual = await vi.importActual<typeof import('../../../../shared/i18n')>('../../../../shared/i18n');
  return {
    ...actual,
    useLanguage: () => ({ t: (k: string) => k, tp: (k: string, c: number) => `${k}:${c}`, language: 'ru' }),
  };
});

function noteOfDay(dayKey: string, id: string, title: string, wordCount: number): ArchiveSession {
  return {
    id, userId: 'u1', title, content: 'Текст заметки этого дня.',
    duration: 120, wordCount, sessionWordsAdded: wordCount, sittings: [], charCount: 20, wpm: 10,
    tags: [], createdAt: new Date(`${dayKey}T12:00:00`), sessionStartTime: new Date(`${dayKey}T12:00:00`).getTime(),
    _isLocal: true,
  } as unknown as ArchiveSession;
}

function keyOf(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function renderList() {
  const today = new Date();
  const days3 = subDays(today, 3);
  const days40 = subDays(today, 40);
  const keys = [keyOf(today), keyOf(subDays(today, 1)), keyOf(days3), keyOf(days40)];
  const grouped: Record<string, ArchiveSession[]> = {
    [keys[0]!]: [noteOfDay(keys[0]!, 'a', 'Сегодняшняя', 12), noteOfDay(keys[0]!, 'b', 'Вторая сегодня', 30)],
    [keys[1]!]: [noteOfDay(keys[1]!, 'c', 'Вчерашняя', 8)],
    [keys[2]!]: [noteOfDay(keys[2]!, 'd', 'Трёхдневная', 5)],
    [keys[3]!]: [noteOfDay(keys[3]!, 'e', 'Сорокадневная', 9)],
  };
  renderWithProviders(
    <MemoryRouter>
      <ArchiveNoteList
      viewMode="list"
      state={{ status: 'data', data: Object.values(grouped).flat() }}
      groupedSessions={grouped}
      sortedDates={keys.slice().sort((a, b) => new Date(b).getTime() - new Date(a).getTime())}
      dateLocale={ru}
      labels={[]}
      userId="u1"
      searchQuery=""
      isGroupedByDate
      onOpen={vi.fn()}
      onDelete={vi.fn()}
      onTagsChange={vi.fn()}
      onTitleChange={vi.fn()}
      onDateChange={vi.fn()}
      onLabelChange={vi.fn()}
      onStorageChange={vi.fn()}
      t={(k: string) => k}
      language="ru"
      allTags={[]}
      />
    </MemoryRouter>
  );
  return { days3, days40, keys };
}

describe('MC-7: заголовки дней на телефоне', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('телефон: заголовок дня — моноширинный капс и счётчики, как на десктопе (U-14)', () => {
    const { keys } = renderList();

    const headers = screen.getAllByTestId('archive-day-header');
    expect(headers).toHaveLength(4);

    const today = headers[0]!;
    expect(today.textContent).toContain(format(new Date(keys[0]!), 'd MMM', { locale: ru }));
    expect(today.textContent).toContain('archive_note_count:2');
    expect(today.textContent).toContain('archive_word_count:42');
    expect(today.querySelector('span')?.className).toContain('font-mono');
    expect(today.querySelector('span')?.className).toContain('uppercase');
    // U-9: на телефоне подпись не мельче 12 px.
    expect(today.querySelector('span')?.className).toContain('text-[12px]');
    // Д-3: разделительные линии на видимом токене.
    expect(today.innerHTML).toContain('--color-border-subtle');
  });

  it('вчера — счётчики один и по словам дня', () => {
    const { keys } = renderList();
    const yesterday = screen.getAllByTestId('archive-day-header')[1]!;
    expect(yesterday.textContent).toContain(format(new Date(keys[1]!), 'd MMM', { locale: ru }));
    expect(yesterday.textContent).toContain('archive_note_count:1');
    expect(yesterday.textContent).toContain('archive_word_count:8');
  });

  it('десктоп: тот же заголовок, подпись `text-label-sm`', () => {
    layoutMode = 'desktop';
    renderList();
    const headers = screen.getAllByTestId('archive-day-header');
    expect(headers).toHaveLength(4);
    expect(headers[0]!.querySelector('span')?.className).toContain('text-label-sm');
    expect(headers[0]!.textContent).toContain('archive_note_count:2');
  });
});

describe('MC-7: «В этот день» — плоская строка', () => {
  const yearAgo = subMonths(new Date(), 12).getTime();

  beforeEach(() => { cleanup(); layoutMode = 'mobile'; localStorage.clear(); });

  function renderCard() {
    const session = {
      id: 'otd_mc7', userId: 'u1', title: 'Двенадцать километров',
      content: 'Считал километры вдоль канала и не заметил, как стемнело.',
      createdAt: yearAgo, duration: 120, wordCount: 9, charCount: 60, wpm: 9, tags: [], _isLocal: true,
    } as unknown as ArchiveSession;
    return renderWithProviders(<OnThisDayCard sessions={[session]} onOpen={vi.fn()} />);
  }

  it('строка — кнопка с заголовком заметки, без цветного левого края', () => {
    const { container } = renderCard();
    expect(screen.getByRole('button', { name: /Двенадцать километров/ })).toBeInTheDocument();
    // Полосу рисовали токены `border-l`/`border-l-2` и инлайн `borderLeft`.
    // Ищем именно токен: подстроку «border-l» содержит и безобидный
    // `border-[var(--border-light)]`.
    const striped = Array.from(container.querySelectorAll<HTMLElement>('*')).some(el =>
      /(^|\s)border-l(\s|-\d|-\[)/.test(el.className) || /border-left/.test(el.getAttribute('style') ?? ''));
    expect(striped, 'осталась левая полоса').toBe(false);
  });
});
