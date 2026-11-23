// NB-11 (sus13, вход «превью заметки»): файл экспорта не создался — тост
// «Не удалось сохранить файл», а не молча закрытый лист.
// Мутация: вернуть void fn() без catch — красный; откат зелёный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
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

const createObjectURL = vi.fn(() => 'blob:synthetic');
const revokeObjectURL = vi.fn();

function renderPreview() {
  return renderWithProviders(
    <MemoryRouter>
      <ToastProvider>
        <DocumentPreview
          session={base} onClose={vi.fn()} onContinue={vi.fn()}
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
  createObjectURL.mockReturnValue('blob:synthetic');
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const openTxtExport = async () => {
  renderPreview();
  fireEvent.click(screen.getByTitle('Экспортировать'));
  fireEvent.click(await screen.findByText('Текстовый (.txt)'));
};

describe('NB-11: превью — отказ экспорта назван', () => {
  it('файл не создался → тост «Не удалось сохранить файл»', async () => {
    createObjectURL.mockImplementation(() => { throw new Error('SYNTHETIC_QUOTA'); });

    await openTxtExport();

    expect(await screen.findByText('Не удалось сохранить файл')).toBeTruthy();
  });

  it('контроль: файл создан — тоста ошибки нет', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await openTxtExport();

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(screen.queryByText('Не удалось сохранить файл')).toBeNull();
  });
});