// NB-11 (sus13, экспорт профиля): handleExportProfile без try — отказ
// exportMarkdown не виден человеком. Мутация: убрать catch — красный.
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

describe('sus13: экспорт профиля — отказ назван', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockProfile.getPortrait.mockResolvedValue(PORTRAIT);
    mockProfile.isPortraitStale.mockResolvedValue(false);
  });

  it('exportMarkdown бросает → тост «Не удалось сохранить файл»', async () => {
    mockProfile.exportMarkdown.mockRejectedValue(new Error('SYNTHETIC_DISK'));

    render(<AuthorPortrait />);
    fireEvent.click(await screen.findByText('Экспорт .md'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Не удалось сохранить файл', 'error');
    });
  });

  it('контроль: экспорт прошёл — тоста ошибки нет', async () => {
    mockProfile.exportMarkdown.mockResolvedValue(PORTRAIT);

    render(<AuthorPortrait />);
    fireEvent.click(await screen.findByText('Экспорт .md'));

    await waitFor(() => expect(mockProfile.exportMarkdown).toHaveBeenCalled());
    expect(mockShowToast).not.toHaveBeenCalledWith('Не удалось сохранить файл', 'error');
  });
});

describe('PIN-1: пересборка портрета — partial и отказ названы', () => {
  const PARTIAL_TEXT = 'Портрет обновлён не полностью: часть разделов из прошлой сборки или ещё не готова';
  const SUCCESS_TEXT = 'Психологический портрет обновлён';

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('language', 'ru');
    mockProfile.getPortrait.mockResolvedValue(PORTRAIT);
    mockProfile.isPortraitStale.mockResolvedValue(false);
  });

  it('PIN-1: partial — warning с причиной, не зелёный успех', async () => {
    mockProfile.generate.mockResolvedValue({ ok: true, partial: true, markdown: PORTRAIT });
    render(<AuthorPortrait />);
    fireEvent.click(await screen.findByText('Обновить'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(PARTIAL_TEXT, 'warning'));
    expect(mockShowToast).not.toHaveBeenCalledWith(SUCCESS_TEXT, 'success');
  });

  it('PIN-1: ok:false — error с причиной, не успех', async () => {
    mockProfile.generate.mockResolvedValue({ ok: false, error: 'SYNTHETIC_FAIL' });
    render(<AuthorPortrait />);
    fireEvent.click(await screen.findByText('Обновить'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Не удалось создать портрет: SYNTHETIC_FAIL', 'error'));
    expect(mockShowToast).not.toHaveBeenCalledWith(SUCCESS_TEXT, 'success');
  });

  it('PIN-1 контроль: полный успех — зелёный тост как раньше', async () => {
    mockProfile.generate.mockResolvedValue({ ok: true, partial: false, markdown: PORTRAIT });
    render(<AuthorPortrait />);
    fireEvent.click(await screen.findByText('Обновить'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(SUCCESS_TEXT, 'success'));
    expect(mockShowToast).not.toHaveBeenCalledWith(PARTIAL_TEXT, 'warning');
  });
});