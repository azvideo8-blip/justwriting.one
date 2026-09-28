import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../../shared/i18n';
import { PrivacyConsentBody } from '../components/PrivacyConsentBody';
import { SignOutConfirmModal } from '../components/SignOutConfirmModal';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';

vi.mock('../services/localDataInventory', () => ({
  countLocalDataInventory: vi.fn().mockResolvedValue({
    notesCount: 5,
    versionsCount: 10,
    dialoguesCount: 2,
    facetsCount: 1,
    lifeStoryCount: 0,
    themeCount: 4,
    beliefsCount: 3,
    hasPortrait: true,
    unsyncedNotesCount: 2,
  }),
}));

const mockUser = { uid: 'u123' };

vi.mock('../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: mockUser, loading: false }),
}));

vi.mock('../../../core/auth/supabaseAuthProvider', () => ({
  updateUserPassword: vi.fn().mockResolvedValue(undefined),
  signOutUser: vi.fn().mockResolvedValue(undefined),
  onPasswordRecovery: (fn: () => void) => { void fn; return () => {}; },
  verifyOtpForRecovery: vi.fn().mockResolvedValue(undefined),
  getCurrentUser: vi.fn().mockReturnValue({ uid: 'u123', email: 'test@example.com' }),
}));

function renderInEnglish(ui: React.ReactElement) {
  localStorage.setItem('app_language', 'en');
  return render(
    <LanguageProvider>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </LanguageProvider>
  );
}

describe('B-3.2 (F-019) Screens English localization (no Cyrillic characters)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('PrivacyConsentBody has no Cyrillic text when rendered in English', () => {
    const { container } = renderInEnglish(
      <PrivacyConsentBody
        checked={false}
        onChecked={() => {}}
        aiConsent={false}
        onAiConsent={() => {}}
      />
    );

    expect(container.textContent).not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('SignOutConfirmModal has no Cyrillic text when rendered in English', async () => {
    const { container, findByText, getByRole } = renderInEnglish(
      <SignOutConfirmModal
        open={true}
        onClose={() => {}}
        onConfirm={async () => {}}
      />
    );

    expect(container.textContent).not.toMatch(/[а-яёА-ЯЁ]/);

    // Check the wipe checkbox to show inventory
    const checkbox = getByRole('checkbox');
    fireEvent.click(checkbox);

    // Wait for inventory loading
    await findByText(/Notes:/);
    expect(container.textContent).not.toMatch(/[а-яёА-ЯЁ]/);
  });

  it('ResetPasswordPage has no Cyrillic text when rendered in English', () => {
    const { container } = renderInEnglish(<ResetPasswordPage />);
    expect(container.textContent).not.toMatch(/[а-яёА-ЯЁ]/);
  });
});
