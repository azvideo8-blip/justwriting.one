import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { SettingsPanel } from '../SettingsPanel';
import { ThemeProvider } from '../../../../core/theme/ThemeProvider';
import { WritingSettingsProvider } from '../../../writing/contexts/WritingSettingsContext';

describe('SettingsPanel (Editor Panel)', () => {
  it('renders single editor panel without tablist', () => {
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
    expect(screen.getByText(/Шрифт|Font/)).toBeInTheDocument();
    expect(screen.getByText(/Дизайн|Design|Theme/)).toBeInTheDocument();
    expect(screen.getByText(/Язык|Language/)).toBeInTheDocument();

    // Close button triggers onClose
    const closeBtn = screen.getByRole('button', { name: /Закрыть|Close/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
