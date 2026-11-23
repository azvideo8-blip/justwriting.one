// NB-8 (sus11, вход «превью заметки»): разбор прошёл, а вектор не построен
// (indexed: daily/rate/error) — warning «в поиск по смыслу пока не вошло»,
// а не зелёное «Заметка разобрана».
// Мутация: убрать ветки indexed (снова только res.ok) — красный; откат зелёный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import type { ArchiveSession } from '../../types';

const loadSessionContent = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/services/UnifiedSessionLoader', async (orig) => ({ ...(await orig<object>()), loadSessionContent }));
vi.mock('../../../../core/storage/localDb', async (orig) => ({ ...(await orig<object>()), getLocalDb: async () => ({ get: vi.fn() }) }));
vi.mock('../../../../core/auth', async (orig) => ({ ...(await orig<object>()), getCurrentUser: () => ({ uid: 'user-1' }) }));

import { DocumentPreview } from '../DocumentPreview';

const base: ArchiveSession = {
  id: 'doc-1', userId: 'user-1', title: 'Заметка', content: 'Синтетический текст.', duration: 60, wordCount: 3, charCount: 20, wpm: 3, tags: [], createdAt: Date.now(), _isLocal: true,
};

const onAnalyzeNote = vi.fn();

function renderPreview() {
  return renderWithProviders(
    <MemoryRouter>
      <ToastProvider>
        <DocumentPreview
          session={base} onClose={vi.fn()} onContinue={vi.fn()} onAnalyzeNote={onAnalyzeNote}
          fetchSummary={async () => null}
          fetchRelatedNotes={async () => [] as never}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  loadSessionContent.mockResolvedValue({ content: base.content, _contentNotLoaded: false });
  onAnalyzeNote.mockResolvedValue({ ok: true, indexed: 'ok' });
});

describe('NB-8: превью — итог разбора называет вектор', () => {
  it('indexed=rate — warning про лимит, не «Заметка разобрана»', async () => {
    onAnalyzeNote.mockResolvedValue({ ok: true, indexed: 'rate' });
    renderPreview();
    fireEvent.click(await screen.findByText('Разобрать заметку через ИИ'));
    expect(await screen.findByText('Заметка разобрана, но в поиск по смыслу пока не вошла — лимит индексации')).toBeTruthy();
    expect(screen.queryByText('Заметка разобрана')).toBeNull();
  });

  it('indexed=error — warning про ошибку индексации', async () => {
    onAnalyzeNote.mockResolvedValue({ ok: true, indexed: 'error' });
    renderPreview();
    fireEvent.click(await screen.findByText('Разобрать заметку через ИИ'));
    expect(await screen.findByText('Заметка разобрана, но в поиск по смыслу пока не вошла — индексация не удалась')).toBeTruthy();
    expect(screen.queryByText('Заметка разобрана')).toBeNull();
  });

  it('контроль: indexed=ok — зелёное «Заметка разобрана»', async () => {
    renderPreview();
    fireEvent.click(await screen.findByText('Разобрать заметку через ИИ'));
    expect(await screen.findByText('Заметка разобрана')).toBeTruthy();
  });
});