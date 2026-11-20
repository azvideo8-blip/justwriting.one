// MF-15: «Что заметил ИИ» в «Инфо» читалки показывал только сводку. Теперь —
// то же, что десктопное превью: сводка, темы, тон, инсайты, факты; кнопка
// разбора — только пока сводки нет («Обновить разбор» убрана).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { MobileNoteReader } from '../MobileNoteReader';
import type { ArchiveSession } from '../../types';
import type { Label } from '../../../../types';

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

const session: ArchiveSession = {
  id: 'doc-mp1',
  userId: 'user-mp1',
  title: 'Про гончарный круг',
  content: 'Глина сохнет быстрее, чем кажется. Поэтому круг крутят медленно.',
  duration: 240,
  wordCount: 12,
  charCount: 68,
  wpm: 3,
  tags: ['глина'],
  labelId: 'label-work',
  createdAt: new Date(2026, 9, 14, 19, 5).getTime(),
  _isLocal: true,
} as unknown as ArchiveSession;

const labels: Label[] = [{ id: 'label-work', name: 'Работа', color: '#7D4FD1' }];

const full = {
  summary: 'Про терпение к материалу.', themes: ['глина', 'терпение'], tone: 'спокойный',
  insights: ['Медленный круг — меньше брака'], extractedFacts: ['Глина сохнет за ночь'],
};

function openInfo(summary: unknown, onAnalyze = vi.fn()) {
  renderWithProviders(
    <MemoryRouter>
      <ToastProvider>
        <MobileNoteReader session={session} onClose={vi.fn()} onContinue={vi.fn()} onRetryContent={vi.fn()} labels={labels}
          summary={summary as never} onAnalyze={onAnalyze} />
      </ToastProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Инфо' }));
  return screen.getByRole('dialog', { name: 'Инфо' });
}

describe('MF-15: what the AI noticed', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('summary, themes, tone, insights and facts render in order', () => {
    const info = openInfo(full);
    const text = info.textContent ?? '';
    expect(text).toContain('Про терпение к материалу.');
    expect(text).toContain('глина · терпение');
    expect(text).toContain('спокойный');
    expect(screen.getByText('Медленный круг — меньше брака').tagName).toBe('LI');
    expect(screen.getByText('Глина сохнет за ночь').tagName).toBe('LI');
    const order = ['Про терпение', 'глина · терпение', 'спокойный', 'Медленный круг', 'Глина сохнет за ночь'].map(s => text.indexOf(s));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('empty insights → no heading', () => {
    openInfo({ ...full, insights: [] });
    expect(screen.queryByText('Инсайты:')).toBeNull();
    expect(screen.getByText('Факты:')).toBeInTheDocument();
  });

  it('a note with a summary has no analyse button; a note without one has it', () => {
    const info = openInfo(full);
    expect(info.querySelectorAll('button').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Обновить разбор|Разобрать заметку через ИИ/ })).toBeNull();
    cleanup();
    openInfo(null);
    expect(screen.getByRole('button', { name: /Разобрать заметку через ИИ/ })).toBeInTheDocument();
  });
});
