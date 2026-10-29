// Дейлик 29.10 Н-5 (DY9-5). Мутация: убрать ветку WrongPasswordError → красный.
// d29d: «Сменить пароль» с опечаткой в текущем пароле. EncryptionService.changePassword
// бросает WrongPasswordError (EncryptionService.ts:446/454), а AccountSecuritySection.tsx:61-69
// узнаёт неверный пароль только по `code === 'invalid_credentials'` (код GoTrue) →
// человек видит «Произошла ошибка при входе.», и каждая опечатка уходит в reportError.
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const reported: unknown[] = [];
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: (e: unknown) => { reported.push(e); } }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: () => {} }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isAuthenticated: true }) }));
vi.mock('../../../../app/AuthService', () => ({ AuthService: { getCurrentUser: () => ({ email: 'd29d@example.test' }) } }));
vi.mock('../AccountVaultSection', () => ({ AccountVaultSection: () => null }));
vi.mock('../VaultOutOfSyncBanner', () => ({ VaultOutOfSyncBanner: () => null }));
vi.mock('../AccountAISection', () => ({ AccountAISection: () => null }));
vi.mock('../../../../core/services/EncryptionService', async () => {
  const { WrongPasswordError } = await vi.importActual<typeof import('../../../../core/services/EncryptionService')>('../../../../core/services/EncryptionService');
  return { WrongPasswordError, EncryptionService: { changePassword: async () => { throw new WrongPasswordError(); } } };
});

import { AccountSecuritySection } from '../AccountSecuritySection';

describe('d29d: wrong current password on "change password"', () => {
  it('says "wrong password", not a generic sign-in error, and does not log the typo as an error', async () => {
    render(h(AccountSecuritySection, { userId: 'u_d29d' }));
    fireEvent.click(screen.getByRole('button', { name: 'settings_change_password' }));
    fireEvent.change(screen.getByPlaceholderText('settings_current_password'), { target: { value: 'MARKER_DAILY_D29D_typo' } });
    fireEvent.change(screen.getByPlaceholderText('settings_new_password'), { target: { value: 'MARKER_DAILY_D29D_new_pw' } });
    fireEvent.submit(screen.getByPlaceholderText('settings_new_password').closest('form')!);
    await waitFor(() => expect(screen.queryByText(/auth_error_/)).not.toBeNull());
    expect(screen.queryByText('auth_error_generic'), 'показан общий текст «Произошла ошибка при входе.»').toBeNull();
    expect(screen.queryByText('auth_error_wrong_password')).not.toBeNull();
    expect(reported).toHaveLength(0);
  });
});
