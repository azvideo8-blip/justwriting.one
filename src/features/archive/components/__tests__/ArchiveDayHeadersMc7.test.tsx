// MC-7: заголовки дней на телефоне — только слова («Сегодня», «Вчера»,
// «11 октября», «Сентябрь»), без монополосы со счётчиками: счётчики уходят в
// лист «Календарь и статистика». «В этот день» — обычная строка-кнопка без
// цветного левого края. Десктопные заголовки не меняются.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { format, subDays, subMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import { renderWithProviders } from '../../../../test/utils/render';
import { ArchiveNoteList } from '../ArchiveNoteList';
import { OnThisDayCard } from '../OnThisDayCard';
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
      loading={false}
      error={null}
      filteredSessions={Object.values(grouped).flat()}
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
  return { days3, days40 };
}

describe('MC-7: заголовки дней на телефоне', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('сегодня/вчера/три дня/сорок дней — словами, без счётчиков', () => {
    const { days3, days40 } = renderList();

    const headers = screen.getAllByTestId('archive-day-header').map(el => el.textContent);
    expect(headers).toEqual([
      'archive_day_today',
      'archive_day_yesterday',
      format(days3, 'd MMMM', { locale: ru }),
      format(days40, 'LLLL', { locale: ru }).replace(/^./, c => c.toUpperCase()),
    ]);
    expect(screen.queryByText(/слов/), 'в заголовках остались слова').toBeNull();
    expect(screen.queryByText(/archive_word_count/), 'счётчик слов уехал в заголовок').toBeNull();
    expect(screen.queryByText(/archive_note_count/), 'счётчик заметок уехал в заголовок').toBeNull();
  });

  it('десктопные заголовки счётчики показывают', () => {
    layoutMode = 'desktop';
    renderList();
    expect(screen.queryAllByTestId('archive-day-header')).toHaveLength(0);
    expect(screen.getAllByText(/archive_note_count/).length).toBeGreaterThan(0);
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
