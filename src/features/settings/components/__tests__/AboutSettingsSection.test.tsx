import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { renderWithProviders } from '../../../../test/utils/render';
import { AboutSettingsSection } from '../AboutSettingsSection';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock('../../auth/hooks/useAdminStatus', () => ({
  useAdminStatus: () => ({
    isAdmin: false,
  }),
}));

describe('AboutSettingsSection (UI-12)', () => {
  it('navigates to /help when Help button is clicked', () => {
    renderWithProviders(<AboutSettingsSection />);

    const helpBtn = screen.getByRole('button', { name: /Помощь: заметки не видны\?/i });
    expect(helpBtn).toBeInTheDocument();

    fireEvent.click(helpBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/help');
  });
});
