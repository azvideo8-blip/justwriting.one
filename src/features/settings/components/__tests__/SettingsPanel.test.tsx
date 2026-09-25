import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { SettingsPanel } from '../SettingsPanel';
import { ThemeProvider } from '../../../../core/theme/ThemeProvider';
import { WritingSettingsProvider } from '../../../../core/settings/WritingSettingsContext';

describe('SettingsPanel (Editor Panel)', () => {
  // Медленный по делу: ленивая загрузка вкладки настроек через dynamic import (lazy chunk) и ожидание отрисовки (до ~3.6 с под нагрузкой).
  it('renders single editor panel without tablist', async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <ThemeProvider>
        <WritingSettingsProvider>
          <SettingsPanel isOpen={true} onClose={onClose} userId="u1" />
        </WritingSettingsProvider>
      </ThemeProvider>
    );

    // Title should be Editor
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/Редактор|Editor/);

    // No tab list should be present
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();

    // Editor controls should be present
    // Вкладка грузится лениво (бюджет стартового куска).
    expect(await screen.findByText(/Шрифт|Font/, {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText(/Дизайн|Design|Theme/)).toBeInTheDocument();
    expect(screen.getByText(/Язык|Language/)).toBeInTheDocument();

    // Close button triggers onClose
    const closeBtn = screen.getByRole('button', { name: /Закрыть|Close/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  }, 15_000);
});
