import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { renderWithProviders } from '../../../../test/utils/render';
import { HelpTree, findPathToNode, NOTES_MISSING_TREE } from '../HelpTree';

const { mockShowToast } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

describe('findPathToNode', () => {
  it('finds path from root to leaf node', () => {
    const path = findPathToNode(NOTES_MISSING_TREE, 'help-notes-missing-3');
    expect(path).toHaveLength(3);
    expect(path?.map(n => n.id)).toEqual([
      'help-notes-missing-1',
      'help-notes-missing-2',
      'help-notes-missing-3',
    ]);
  });

  it('returns null for non-existent node id', () => {
    expect(findPathToNode(NOTES_MISSING_TREE, 'non-existent')).toBeNull();
  });
});

describe('HelpTree (UI-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
  });

  it('navigates path "Да -> Да -> Да" to cache reload solution and allows going back', async () => {
    renderWithProviders(<HelpTree />);

    // Step 1
    expect(screen.getByText(/Это тот же аккаунт, что и раньше/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));

    // Step 2
    await waitFor(() => {
      expect(screen.getByText(/Это тот же браузер и то же устройство/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));

    // Step 3
    await waitFor(() => {
      expect(screen.getByText(/Приложение обновлялось или было открыто давно/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));

    // Solution reached (Cmd+Shift+R / cache reload)
    await waitFor(() => {
      expect(screen.getByText(/Перезагрузи страницу с полной очисткой кеша/i)).toBeInTheDocument();
    });

    // Click "Назад" - returns to question 3
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    await waitFor(() => {
      expect(screen.getByText(/Приложение обновлялось или было открыто давно/i)).toBeInTheDocument();
    });

    // Click "Назад" again - returns to question 2
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    await waitFor(() => {
      expect(screen.getByText(/Это тот же браузер и то же устройство/i)).toBeInTheDocument();
    });
  });

  it('opens directly at step 3 when URL hash is #help-notes-missing-3', async () => {
    window.location.hash = '#help-notes-missing-3';

    renderWithProviders(<HelpTree />);

    await waitFor(() => {
      expect(screen.getByText(/Приложение обновлялось или было открыто давно/i)).toBeInTheDocument();
    });

    // Answering "Нет" leads to filters solution
    fireEvent.click(screen.getByRole('button', { name: 'Нет' }));

    await waitFor(() => {
      expect(screen.getByText(/Проверь фильтры в меню «Заметки»/i)).toBeInTheDocument();
    });

    // "Сначала" button resets back to step 1
    fireEvent.click(screen.getByRole('button', { name: 'Сначала' }));
    await waitFor(() => {
      expect(screen.getByText(/Это тот же аккаунт, что и раньше/i)).toBeInTheDocument();
    });
  });

  it('copies link to current step to clipboard and displays toast', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    renderWithProviders(<HelpTree />);

    const copyBtn = screen.getByLabelText('Скопировать ссылку на этот шаг');
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('#help-notes-missing-1'));
      expect(mockShowToast).toHaveBeenCalledWith('Ссылка на шаг скопирована', 'success');
    });
  });

  // 0.11.22: нет буфера обмена (не https, запрет браузера) — было «скопирована»
  // без копирования. Мутация: вернуть проверку `typeof … === 'function'` без
  // ошибки — красный.
  it('буфер обмена отказал — ошибка, а не «скопирована»', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) } });
    renderWithProviders(<HelpTree />);
    fireEvent.click(screen.getByLabelText('Скопировать ссылку на этот шаг'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.stringMatching(/Не удалось скопировать/), 'error'));
    expect(mockShowToast).not.toHaveBeenCalledWith('Ссылка на шаг скопирована', 'success');
  });
});
