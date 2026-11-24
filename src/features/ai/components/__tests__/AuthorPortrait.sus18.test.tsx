// NB-12 (sus18б, вход «портрет»): отказ чтения версии промптов — состояние
// error с «Повторить», а не «портрет свежий». Мутация: catch → return false
// в isPortraitStale — красный; откат зелёный.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { LanguageProvider } from '../../../../shared/i18n';

const { mockProfile, mockShowToast } = vi.hoisted(() => ({
  mockProfile: {
    getPortrait: vi.fn(),
    isPortraitStale: vi.fn(),
    generate: vi.fn(),
    exportMarkdown: vi.fn(),
  },
  mockShowToast: vi.fn(),
}));

vi.mock('../../services/AIProfileService', () => ({ AIProfileService: mockProfile }));
vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: async () => ({ getAll: async () => [] }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock('../../components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

import { AuthorPortrait } from '../AuthorPortrait';

const PORTRAIT = '# Психологический портрет пользователя\n\n## Стиль общения\nСинтетический текст.';
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: LanguageProvider });

describe('sus18: портрет — отказ чтения версии назван', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockProfile.getPortrait.mockResolvedValue(PORTRAIT);
    mockProfile.isPortraitStale.mockResolvedValue(false);
  });

  it('isPortraitStale упал → error с «Повторить», портрет не показан как свежий', async () => {
    mockProfile.isPortraitStale.mockRejectedValue(new Error('SYNTHETIC_IDB_DOWN'));

    render(<AuthorPortrait readOnly />);

    await screen.findByRole('alert');
    expect(screen.queryByTestId('md')).toBeNull();
    expect(screen.queryByText(/Портрет ещё не создан/)).toBeNull();
  });

  it('повтор перечитывает: отказ был разовым → портрет показан', async () => {
    mockProfile.isPortraitStale
      .mockRejectedValueOnce(new Error('SYNTHETIC_IDB_DOWN'))
      .mockResolvedValue(false);

    render(<AuthorPortrait readOnly />);

    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByTestId('md').textContent).toContain('Синтетический текст'));
  });

  it('контроль: чтения прошли → портрет показан, ошибки нет', async () => {
    render(<AuthorPortrait readOnly />);

    await screen.findByTestId('md');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Мутация: убрать ветку saved — зелёный тост, красный тест.
  it('портрет собран, но не сохранился → предупреждение, а не «обновлён»', async () => {
    mockProfile.generate.mockResolvedValue({ ok: true, markdown: PORTRAIT, partial: false, saved: false });
    render(<AuthorPortrait />);
    await screen.findByTestId('md');
    fireEvent.click(screen.getByRole('button', { name: /Обновить|Сгенерировать|Создать/ }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('не сохранился'), 'warning'));
    expect(mockShowToast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });
});