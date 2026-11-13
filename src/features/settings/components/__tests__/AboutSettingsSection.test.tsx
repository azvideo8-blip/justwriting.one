import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { renderWithProviders } from '../../../../test/utils/render';
import { AboutSettingsSection } from '../AboutSettingsSection';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const mockShowToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

let mockIsAdmin = false;
vi.mock('../../../auth/hooks/useAdminStatus', () => ({
  useAdminStatus: () => ({
    isAdmin: mockIsAdmin,
  }),
}));

describe('AboutSettingsSection (UI-12 & D-16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockIsAdmin = false;
  });

  it('navigates to /help when Help button is clicked', () => {
    renderWithProviders(<AboutSettingsSection />);

    const helpBtn = screen.getByRole('button', { name: /Помощь: заметки не видны\?/i });
    expect(helpBtn).toBeInTheDocument();

    fireEvent.click(helpBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/help');
  });

  it('does not unlock diagnostics or show toast on 5 taps if user is not admin (D-16)', () => {
    mockIsAdmin = false;
    renderWithProviders(<AboutSettingsSection />);

    const versionBtn = screen.getByRole('button', { name: /^Версия/i });
    for (let i = 0; i < 5; i++) {
      fireEvent.click(versionBtn);
    }

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('diagnostics_unlocked')).toBeNull();
    expect(screen.queryByRole('button', { name: /диагностик/i })).toBeNull();
  });

  it('does not show diagnostics button to non-admin even if diagnostics_unlocked was previously set (D-16)', () => {
    mockIsAdmin = false;
    sessionStorage.setItem('diagnostics_unlocked', 'true');
    renderWithProviders(<AboutSettingsSection />);

    expect(screen.queryByRole('button', { name: /диагностик/i })).toBeNull();
  });

  it('unlocks diagnostics button and shows toast on 5 taps when user is admin (D-16)', () => {
    mockIsAdmin = true;
    renderWithProviders(<AboutSettingsSection />);

    const versionBtn = screen.getByRole('button', { name: /^Версия/i });
    for (let i = 0; i < 5; i++) {
      fireEvent.click(versionBtn);
    }

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('diagnostics_unlocked')).toBe('true');
    expect(screen.getByRole('button', { name: /диагностик/i })).toBeInTheDocument();
  });

  // TR-6: знакомство ещё раз — из «Настройки → О программе».
  // Мутация: убрать onClick={startTour} → красный.
  it('«Как всё устроено» отправляет jw:tour-start', () => {
    const heard = vi.fn();
    window.addEventListener('jw:tour-start', heard);
    renderWithProviders(<AboutSettingsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Как всё устроено' }));
    window.removeEventListener('jw:tour-start', heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
