// NB-3 (sus09, вызывающий): отказ чтения разбора в превью — строка «облако не
// ответило» с «Повторить», кнопка «Разобрать» не показывается (иначе человек
// тратит ИИ повторно на разбор, который уже есть). Оба вида: десктоп и читалка.
// Мутация: убрать ветку summaryLoadFailed → красный (кнопка «Разобрать» снова видна).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import type { ArchiveSession } from '../../types';

let layoutMode: 'desktop' | 'mobile' = 'desktop';
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));

const loadSessionContent = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/services/UnifiedSessionLoader', async (orig) => ({ ...(await orig<object>()), loadSessionContent }));
vi.mock('../../../../core/storage/localDb', async (orig) => ({ ...(await orig<object>()), getLocalDb: async () => ({ get: vi.fn(async () => undefined) }) }));
vi.mock('../../../../core/auth', async (orig) => ({ ...(await orig<object>()), getCurrentUser: () => ({ uid: 'user-1' }) }));

import { DocumentPreview } from '../DocumentPreview';

const base: ArchiveSession = {
  id: 'doc-sus09', userId: 'user-1', title: 'Заметка', content: 'Синтетический текст.', duration: 60, wordCount: 3, charCount: 20, wpm: 3, tags: [], createdAt: Date.now(), _isLocal: true,
};

function renderPreview(fetchSummary: () => Promise<null>) {
  return renderWithProviders(
    <MemoryRouter>
      <ToastProvider>
        <DocumentPreview
          session={base} onClose={vi.fn()} onContinue={vi.fn()} onAnalyzeNote={vi.fn()}
          fetchSummary={fetchSummary}
          fetchRelatedNotes={async () => [] as never}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('NB-3 sus09: preview shows read refusal, not «Разобрать»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    layoutMode = 'desktop';
    loadSessionContent.mockResolvedValue({ content: 'Синтетический текст.', _contentNotLoaded: false });
  });

  it('десктоп: отказ → ошибка с «Повторить», кнопки «Разобрать» нет; повтор перечитывает', async () => {
    const fetchSummary = vi.fn()
      .mockRejectedValueOnce(new Error('cloud down'))
      .mockResolvedValue(null);
    renderPreview(fetchSummary);
    expect(await screen.findByText('Разбор не прочитался — облако не ответило.')).toBeTruthy();
    expect(screen.queryByText('Разобрать заметку через ИИ')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Разобрать заметку через ИИ')).toBeTruthy();
    expect(fetchSummary.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('читалка (mobile): отказ → ошибка с «Повторить», кнопки «Разобрать» нет', async () => {
    layoutMode = 'mobile';
    const fetchSummary = vi.fn()
      .mockRejectedValueOnce(new Error('cloud down'))
      .mockResolvedValue(null);
    renderPreview(fetchSummary);
    fireEvent.click(screen.getByRole('button', { name: 'Инфо' }));
    expect(await screen.findByText('Разбор не прочитался — облако не ответило.')).toBeTruthy();
    expect(screen.queryByText('Разобрать заметку через ИИ')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Разобрать заметку через ИИ')).toBeTruthy();
    expect(fetchSummary.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('контроль: разбора действительно нет → кнопка «Разобрать» на месте', async () => {
    renderPreview(async () => null);
    expect(await screen.findByText('Разобрать заметку через ИИ')).toBeTruthy();
    expect(screen.queryByText('Разбор не прочитался — облако не ответило.')).toBeNull();
  });
});