// U-25 (решение владельца 2026-10-18): читалка на телефоне — как десктопная
// превью-панель: блок ИИ в карточке, «Разобрать» со значком и обводкой, у
// запертой заметки Lock 32 и заголовок, связанные записи — карточками.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { MobileNoteReader } from '../MobileNoteReader';
import type { ArchiveSession } from '../../types';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));

const base = {
  id: 'doc-u25',
  userId: 'user-u25',
  title: 'Про гончарный круг',
  content: 'Глина сохнет быстрее, чем кажется. Поэтому круг крутят медленно.',
  duration: 240,
  wordCount: 12,
  charCount: 68,
  wpm: 3,
  tags: [],
  createdAt: new Date(2026, 9, 14, 19, 5).getTime(),
  _isLocal: true,
};

const summary = {
  summary: 'Про терпение к материалу.', themes: ['глина'], tone: 'спокойный',
  insights: ['Медленный круг — меньше брака'], extractedFacts: ['Глина сохнет за ночь'],
};

type Options = { sessionExtra?: Record<string, unknown>; summaryValue?: unknown; related?: unknown[]; openInfo?: boolean };

function renderReader({ sessionExtra = {}, summaryValue = null, related, openInfo = false }: Options = {}) {
  cleanup();
  layoutMode = 'mobile';
  renderWithProviders(
    <MemoryRouter>
      <ToastProvider>
        <MobileNoteReader
          session={{ ...base, ...sessionExtra } as unknown as ArchiveSession}
          onClose={vi.fn()}
          onContinue={vi.fn()}
          onAnalyze={vi.fn()}
          summary={summaryValue as never}
          relatedNotes={related as never}
          onSelectRelated={related ? vi.fn() : undefined}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
  if (openInfo) fireEvent.click(screen.getByRole('button', { name: 'Инфо' }));
}

describe('U-25: читалка как десктопная превью-панель', () => {
  beforeEach(() => { cleanup(); });

  it('разбор ИИ лежит в карточке, как на десктопе', () => {
    renderReader({ summaryValue: summary, openInfo: true });
    const text = screen.getByText('Про терпение к материалу.');
    const card = text.closest('.rounded-xl') as HTMLElement;
    expect(card, 'сводки ИИ нет в карточке').toBeTruthy();
    expect(card.className).toContain('border-brand-soft/15');
    expect(card.className).toContain('bg-brand-soft/5');
  });

  it('«Разобрать заметку через ИИ» — со значком и обводкой', () => {
    renderReader({ openInfo: true });
    const btn = screen.getByRole('button', { name: 'Разобрать заметку через ИИ' });
    expect(btn.querySelector('svg'), 'у кнопки разбора нет значка').toBeTruthy();
    expect(btn.className).toContain('border-brand-soft/20');
  });

  it('у запертой заметки — Lock 32 и заголовок, как на десктопе', () => {
    renderReader({ sessionExtra: { _locked: true } });
    const lock = document.querySelector('[data-testid="note-reader"] svg[width="32"]') as SVGSVGElement;
    expect(lock, 'в читалке нет замка').toBeTruthy();
    expect(lock.getAttribute('width')).toBe('32');
    // Заголовок под замком в той же плашке (заголовок экрана запертой заметки —
    // та же строка, поэтому смотрим на соседа значка, а не на весь документ).
    expect(lock.parentElement?.textContent).toContain('Заметка заперта');
  });

  it('связанные записи — карточки, а не голые строки', () => {
    renderReader({ related: [{ documentId: 'd2', title: 'Про печь', date: '2026-10-12', score: 3 }] });
    const link = screen.getByRole('button', { name: /Про печь/ });
    expect(link.className).toContain('rounded-xl');
    expect(link.className).toContain('border-border-subtle/40');
    expect(link.className).toContain('bg-surface-card');
  });
});
