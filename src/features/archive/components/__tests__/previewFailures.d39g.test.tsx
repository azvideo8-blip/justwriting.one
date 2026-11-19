// Дейлик 19.11, подозрения 1, 4, 5 (превью заметки, десктоп):
// 1 — сбой чтения текста (_contentError) показывался как «Содержимое недоступно»
//     (как у пустой заметки), повторить чтение было нельзя;
// 4 — связанная заметка, которой нет на устройстве, не открывалась молча;
// 5 — отказ чтения разбора молчал: кнопка «Разобрать», будто разбора нет.
// Мутации: убрать ветку _contentError / тост «не открылась» / .catch у сводки — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import type { ArchiveSession } from '../../types';

const loadSessionContent = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/services/UnifiedSessionLoader', async (orig) => ({ ...(await orig<object>()), loadSessionContent }));
const dbGet = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/storage/localDb', async (orig) => ({ ...(await orig<object>()), getLocalDb: async () => ({ get: dbGet }) }));
vi.mock('../../../../core/auth', async (orig) => ({ ...(await orig<object>()), getCurrentUser: () => ({ uid: 'user-1' }) }));

import { DocumentPreview } from '../DocumentPreview';

const base: ArchiveSession = {
  id: 'doc-1', userId: 'user-1', title: 'Заметка', content: '', duration: 60, wordCount: 10, charCount: 0, wpm: 10, tags: [], createdAt: Date.now(), _isLocal: true,
};

function renderPreview(session: ArchiveSession, opts: { fetchSummary?: () => Promise<null>; related?: { documentId: string; title: string; date: string; score: number }[] } = {}) {
  return renderWithProviders(
    <MemoryRouter>
      <ToastProvider>
        <DocumentPreview
          session={session} onClose={vi.fn()} onContinue={vi.fn()} onAnalyzeNote={vi.fn()}
          fetchSummary={opts.fetchSummary ?? (async () => null)}
          fetchRelatedNotes={async () => (opts.related ?? []) as never}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('превью: отказы чтения названы', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('1: текст не прочитался — не «Содержимое недоступно», есть «Повторить», повтор перечитывает', async () => {
    loadSessionContent.mockResolvedValue({ content: 'Текст на месте.', _contentNotLoaded: false });
    renderPreview({ ...base, _contentError: true });
    expect(await screen.findByText('Текст заметки не прочитался.')).toBeTruthy();
    expect(screen.queryByText('Содержимое недоступно')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Текст на месте.')).toBeTruthy();
    expect(loadSessionContent).toHaveBeenCalledWith('user-1', 'doc-1');
  });

  it('5: разбор не прочитался — сказано, а не молча «Разобрать»', async () => {
    renderPreview({ ...base, content: 'Текст.' }, { fetchSummary: () => Promise.reject(new Error('IDB down')) });
    expect(await screen.findByText('Разбор не прочитался — открой заметку ещё раз.')).toBeTruthy();
  });

  it('4: связанной заметки нет на устройстве — тост, а не тишина', async () => {
    dbGet.mockResolvedValue(undefined);
    renderPreview({ ...base, id: 'doc-4', content: 'Текст.' }, { related: [{ documentId: 'doc-2', title: 'Связанная', date: '2026-11-01', score: 0.9 }] });
    fireEvent.click(await screen.findByText('Связанная'));
    expect(await screen.findByText('Не удалось загрузить данные.')).toBeTruthy();
  });
});
