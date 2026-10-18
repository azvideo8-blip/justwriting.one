// U-21 (решение владельца 2026-10-18, «десктоп — эталон»): архив на телефоне.
// 1) глиф «⋯» (MoreHorizontal) в строке заметки и в корзине — как на десктопе,
//    цель касания 44 px остаётся;
// 2) колонка времени — 13 px, время без даты (день назван заголовком группы);
// 3) значки копий — тот же набор, порядок и состояния, что у десктопного
//    StorageButtons (HardDrive · Cloud · EyeOff · Sparkles, «не отправлено» —
//    accent-warning, «скрыто от ИИ» — accent-danger), но индикаторы, не кнопки (MR-9);
// 4) карточка сетки — `p-5`, название 17 px, превью `text-text-main/60 leading-relaxed`
//    и строка даты, как у десктопной карточки.
// Кегль и классы проверяются по классам элемента: jsdom не применяет CSS.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NoteRow } from '../NoteRow';
import { GridNoteCard } from '../GridNoteCard';
import { ArchiveTrashView } from '../ArchiveTrashView';
import { StorageStateIcons } from '../StorageStateIcons';
import type { ArchiveSession } from '../../types';
import type { Label } from '../../../../types';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ profile: null, user: null }) }));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ prompt: vi.fn().mockResolvedValue(null), confirm: vi.fn(), alert: vi.fn() }),
}));

const labels: Label[] = [{ id: 'lbl_1', name: 'Работа', color: '#e0a458' }];

const base = {
  id: 'doc_u21', userId: 'u1', content: 'Глина сохнет быстрее, чем кажется.', duration: 300,
  wordCount: 42, sittings: [], tags: [], title: 'Про гончарный круг',
  createdAt: new Date(2026, 9, 14, 9, 33), sessionStartTime: new Date(2026, 9, 14, 9, 33).getTime(),
} as unknown as ArchiveSession;

function row(over: Partial<ArchiveSession> = {}, onOpen = vi.fn()) {
  render(
    <NoteRow
      session={{ ...base, ...over } as ArchiveSession}
      onOpen={onOpen} t={(k: string) => k} language="ru" userId="user_1"
      labels={labels} onTagsChange={vi.fn()} onDelete={vi.fn()}
    />,
  );
  return onOpen;
}

// В lucide 0.546 «⋯» — канонический `ellipsis`, «⋮» — `ellipsis-vertical`:
// последний содержит первый как подстроку, поэтому проверяются токены классов.
const classStrings = (root: Element) => Array.from(root.querySelectorAll('svg')).map(s => s.getAttribute('class') ?? '');
const lucideTokens = (root: Element) => Array.from(root.querySelectorAll('svg'))
  .map(s => (s.getAttribute('class') ?? '').split(/\s+/).find(c => c.startsWith('lucide-') && c !== 'lucide') ?? '');
const stateGroup = () => document.querySelector('[data-storage-state]')!;
const glyphTokens = (root: Element) => (root.querySelector('svg')?.getAttribute('class') ?? '').split(/\s+/);
const moreButton = () => screen.getByRole('button', { name: 'archive_note_actions' });

describe('U-21.1: глиф «⋯» в строке заметки и в корзине', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('строка заметки на телефоне — «⋯», а не «⋮»; цель касания 44 px осталась', () => {
    row();
    const more = moreButton();
    const cls = glyphTokens(more);
    expect(cls, 'в строке не «⋯»').toContain('lucide-ellipsis');
    expect(cls).not.toContain('lucide-ellipsis-vertical');
    expect(more.className).toContain('w-11');
  });

  it('корзина на телефоне — тот же «⋯», цель касания 44 px', () => {
    render(
      <ArchiveTrashView
        trashedSessions={[{ ...base, trashedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 } as ArchiveSession]}
        onRestore={vi.fn().mockResolvedValue(undefined)} onDeletePermanently={vi.fn()}
        onEmptyTrash={vi.fn()} onOpenPreview={vi.fn()}
        t={(k: string) => k} tp={(k: string) => k} isMobile
      />,
    );
    const more = moreButton();
    const cls = glyphTokens(more);
    expect(cls, 'в корзине не «⋯»').toContain('lucide-ellipsis');
    expect(cls).not.toContain('lucide-ellipsis-vertical');
    expect(more.className).toContain('w-11');
  });

  it('десктоп не тронут: там «⋯» был и остался', () => {
    layoutMode = 'desktop';
    row();
    expect(glyphTokens(moreButton())).toContain('lucide-ellipsis');
  });
});

describe('U-21.2: дата в строке заметки — 13 px', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('колонка времени на телефоне — 13 px, ширина 44 px, только время без даты', () => {
    row();
    const time = screen.getByText('09:33');
    expect(time.className, 'на телефоне дата не 13 px').toContain('text-[13px]');
    expect(time.className).not.toContain('text-[12px]');
    expect(time.textContent, 'на телефон перенесли дату — день в заголовке группы').toBe('09:33');
    expect(time.className).toContain('min-w-11');
    expect(time.className).toContain('tabular-nums');
  });
});

describe('U-21.3: значки копий — как десктопный StorageButtons, но индикаторы', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('набор и порядок значков: HardDrive · Cloud · EyeOff · Sparkles', () => {
    render(<StorageStateIcons cloud device analyzed pendingSync={false} excluded={false} />);
    const names = lucideTokens(stateGroup());
    expect(names).toHaveLength(4);
    expect(names[0]).toBe('lucide-hard-drive');
    expect(names[1]).toBe('lucide-cloud');
    expect(names[2]).toBe('lucide-eye-off');
    expect(names[3]).toBe('lucide-sparkles');
    expect(names.join(' ')).not.toContain('lucide-smartphone');
  });

  it('состояния как на десктопе: включённое — brand-soft со свечением, выключенное — text-main/30', () => {
    render(<StorageStateIcons cloud={false} device={false} analyzed={false} pendingSync={false} excluded={false} />);
    const cls = classStrings(stateGroup());
    cls.forEach((c, i) => expect(c, `значок ${i} не приглушён`).toContain('text-text-main/30'));

    cleanup();
    render(<StorageStateIcons cloud device analyzed pendingSync={false} excluded={false} />);
    const on = classStrings(stateGroup());
    expect(on[0]).toContain('text-brand-soft');
    expect(on[0], 'у включённого значка нет свечения, как на десктопе').toContain('drop-shadow');
  });

  it('«не отправлено» — accent-warning со свечением на значке облака', () => {
    render(<StorageStateIcons cloud device analyzed={false} pendingSync excluded={false} />);
    const cls = classStrings(stateGroup());
    expect(cls[1], '«не отправлено» не accent-warning').toContain('text-accent-warning');
    expect(cls[1]).toContain('drop-shadow');
    expect(stateGroup().getAttribute('aria-label')).toContain('archive_status_pending_sync');
  });

  it('«скрыто от ИИ» — accent-danger на EyeOff, а разбор приглушён', () => {
    render(<StorageStateIcons cloud device analyzed pendingSync={false} excluded />);
    const cls = classStrings(stateGroup());
    expect(cls[2], '«скрыто от ИИ» не accent-danger').toContain('text-accent-danger');
    expect(cls[3], 'скрытую от ИИ заметку значок разбора не подсвечивает').toContain('text-text-main/15');
    expect(stateGroup().getAttribute('aria-label')).toContain('ai_note_excluded');
  });

  it('это индикаторы, а не кнопки: ни role=button, ни целей касания, ни обработчика', () => {
    render(<StorageStateIcons cloud device analyzed pendingSync excluded />);
    const g = stateGroup();
    expect(g.getAttribute('role')).toBe('img');
    expect(g.querySelectorAll('button')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // 44-px целей (w-11/h-11/min-h-11) у индикаторов быть не должно — MR-9.
    expect(g.className).not.toMatch(/(?:^|\s)(?:w-11|h-11|min-h-11|min-w-11)(?:\s|$)/);
    for (const svg of Array.from(g.querySelectorAll('svg'))) {
      expect(svg.getAttribute('class')).not.toMatch(/(?:^|\s)(?:w-11|h-11|min-h-11)(?:\s|$)/);
    }
  });

  it('строка на телефоне передаёт «не отправлено» и «скрыто от ИИ» из заметки', () => {
    row({ _isLocal: true, _hasCloudCopy: true, _hasPendingSync: true, excludedFromAI: true });
    const g = stateGroup();
    expect(classStrings(g)).toHaveLength(4);
    const label = g.getAttribute('aria-label')!;
    expect(label).toContain('archive_status_pending_sync');
    expect(label).toContain('ai_note_excluded');
  });

  it('тап по значкам в строке открывает заметку, как тап по ряду', () => {
    const onOpen = row({ _isLocal: true });
    fireEvent.click(stateGroup());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('U-21.4: карточка сетки на телефоне — как десктопная', () => {
  const renderCard = (over: Partial<ArchiveSession> = {}) => render(
    <GridNoteCard
      session={{ ...base, ...over } as ArchiveSession}
      onClick={vi.fn()} userId="user_1" labels={labels} allTags={['глина']} searchQuery=""
    />,
  );

  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('карточка — p-5, название 17 px', () => {
    const { container } = renderCard();
    const card = container.firstElementChild as HTMLElement;
    expect(card.className, 'у карточки не p-5').toContain('p-5');
    expect(card.className).not.toContain('p-4');
    const title = screen.getByRole('heading', { level: 2 });
    expect(title.className, 'название карточки не 17 px').toContain('text-[17px]');
  });

  it('превью — text-text-main/60 leading-relaxed, как на десктопе', () => {
    renderCard();
    const preview = screen.getByText(/Глина сохнет/) as HTMLElement;
    expect(preview.className, 'превью не /60').toContain('text-text-main/60');
    expect(preview.className).not.toContain('text-text-main/70');
    expect(preview.className, 'у превью не leading-relaxed').toContain('leading-relaxed');
  });

  it('строка даты есть, 13 px /60; относительного времени и счётчиков — нет', () => {
    renderCard();
    const date = screen.getByText(/14 окт/);
    expect(date.className, 'дата карточки не 13 px').toContain('text-[13px]');
    expect(date.className).toContain('text-text-main/60');
    // Браузерный храповик MP-2 (e2e/mobile/grid-card-text.mp2.spec.ts:55) считает
    // «назад» в карточке регрессией, поэтому перенесена только строка даты.
    expect(screen.queryByText(/назад/)).toBeNull();
    expect(screen.queryByText(/42 слов/)).toBeNull();
  });

  it('U-34 не сломан: полоса метки и тонировка 4 % в карточке остались', () => {
    const { container } = renderCard({ labelId: 'lbl_1' });
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-l-2');
    expect(card.style.borderLeftColor).not.toBe('');
    expect(card.style.background).toContain('4%');
    expect(card.style.boxShadow).not.toBe('');
    expect(screen.getByText('Работа')).toBeInTheDocument();
    // Кнопок в мобильной карточке по-прежнему нет — вход в лист через долгое нажатие.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('десктопная карточка не тронута: p-5, 17 px, превью /60 и дата с «назад»', () => {
    layoutMode = 'desktop';
    renderCard();
    const title = screen.getByRole('heading', { level: 4 });
    expect(title.className).toContain('text-[17px]');
    expect(screen.getByText(/14 окт/).className).toContain('text-[13px]');
    expect(screen.getByText(/назад/)).toBeInTheDocument();
  });
});
