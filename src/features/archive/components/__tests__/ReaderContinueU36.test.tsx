// U-36 (решение владельца 2026-10-18, Q-8): «Продолжить писать» — кнопка `Button
// primary` внизу читалки, как на десктопе (`DocumentPreview.tsx:790-810`), а не
// только пункт в «⋯». Дубль в «⋯» остаётся.
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
  id: 'doc-u36',
  userId: 'user-u36',
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

function renderReader(extra: Record<string, unknown> = {}) {
  cleanup();
  layoutMode = 'mobile';
  const onContinue = vi.fn();
  const onRetryContent = vi.fn();
  const session = { ...base, ...extra } as unknown as ArchiveSession;
  renderWithProviders(
    <MemoryRouter>
      <ToastProvider>
        <MobileNoteReader session={session} onClose={vi.fn()} onContinue={onContinue} onRetryContent={onRetryContent} summary={null} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return { onContinue, onRetryContent, session };
}

describe('U-36: «Продолжить писать» — кнопкой внизу читалки', () => {
  beforeEach(() => { cleanup(); });

  it('открытая заметка показывает общую primary-кнопку, тап ведёт в редактор', () => {
    const { onContinue, session } = renderReader();
    const button = screen.getByRole('button', { name: 'Продолжить писать' });
    // Десктопный вид: общий `Button primary` (инверсия чернилами), а не текстовая ссылка.
    expect(button.className, 'кнопка не общего primary-вида').toContain('bg-text-main');
    expect(button.className).toContain('text-surface-base');
    fireEvent.click(button);
    expect(onContinue).toHaveBeenCalledWith(session);
  });

  it('запертая заметка кнопкой просит открыть сейф и не зовёт в редактор', () => {
    const { onContinue } = renderReader({ _locked: true });
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить писать' }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(dispatch.mock.calls.some(([e]) => (e as Event).type === 'open-vault-unlock')).toBe(true);
  });

  it('дубль в листе «⋯» остался', () => {
    renderReader();
    fireEvent.click(screen.getByRole('button', { name: 'Действия с заметкой' }));
    const sheet = screen.getByRole('dialog', { name: 'Действия с заметкой' });
    expect(sheet.textContent).toContain('Продолжить писать');
  });
});

// 0.11.22: «текст не прочитался» в читалке — общая панель LoadNotice; повтор
// обязателен по типу. Мутация: onRetry={() => {}} в MobileNoteReader — красный.
describe('читалка: текст не прочитался', () => {
  it('ошибка названа, «Повторить» перечитывает', () => {
    const { onRetryContent } = renderReader({ content: '', _contentError: true });
    expect(screen.getByRole('alert').textContent).toContain('Текст заметки не прочитался.');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onRetryContent).toHaveBeenCalledTimes(1);
  });

  // Дейлик 20.11: текст не прочитался — заметка нечитаема: связанных не показываем.
  // Мутация: убрать `!session._contentError` из readable — красный.
  it('текст не прочитался — без блока связанных', () => {
    cleanup();
    const session = { ...base, content: '', _contentError: true } as unknown as ArchiveSession;
    renderWithProviders(
      <MemoryRouter>
        <ToastProvider>
          <MobileNoteReader session={session} onClose={vi.fn()} onContinue={vi.fn()} onRetryContent={vi.fn()} summary={null}
            relatedNotes={[{ documentId: 'doc-r', title: 'Связанная', date: '2026-11-01', score: 0.9 }]} onSelectRelated={vi.fn()} />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('reader-related')).toBeNull();
  });
});

