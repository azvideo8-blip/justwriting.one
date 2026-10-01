import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AccountDeleteSection } from '../components/AccountDeleteSection';
import { ConfirmDialogRenderer } from '../../../shared/components/ConfirmDialog';
import { LanguageProvider } from '../../../shared/i18n';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { settingsTranslations } from '../../../shared/i18n/translations/settings';
import { LocalWipeFailedError } from '../../auth/services/unsyncedLocalData';

// S-32 (d): аккаунт на сервере удалён, а устройство не очищено — человек
// должен услышать именно это, а не «не удалось удалить аккаунт».

const showToast = vi.fn();
const deleteAccount = vi.fn();

vi.mock('../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isAuthenticated: true }) }));
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../app/AuthService', () => ({ AuthService: { deleteAccount: (...a: unknown[]) => deleteAccount(...a) } }));

const ru = (key: keyof typeof settingsTranslations) => settingsTranslations[key]!.ru;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  localStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, 'ru');
});

async function deleteWith(error: unknown): Promise<void> {
  deleteAccount.mockRejectedValueOnce(error);
  render(
    <LanguageProvider>
      <AccountDeleteSection userId="u_wipe_failed" />
      <ConfirmDialogRenderer />
    </LanguageProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: ru('settings_delete_account_button') }));
  const dialogButtons = within(screen.getByRole('dialog')).getAllByRole('button');
  fireEvent.click(dialogButtons[dialogButtons.length - 1]!);
  const input = await screen.findByLabelText(ru('settings_delete_account_password_placeholder'));
  fireEvent.change(input, { target: { value: 'secretPassword' } });
  fireEvent.click(screen.getByRole('button', { name: ru('settings_delete_account_confirm_button') }));
  await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith('secretPassword'));
}

describe('S-32: AccountDeleteSection after a LocalWipeFailedError', () => {
  it('says the account is deleted but the device is not cleared', async () => {
    await deleteWith(new LocalWipeFailedError(new Error('IDB locked')));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(ru('settings_delete_account_device_not_cleared'), 'warning'));
    expect(showToast).not.toHaveBeenCalledWith(ru('settings_delete_account_error'), expect.anything());
  });

  it('a server refusal still reads as «не удалось удалить аккаунт»', async () => {
    await deleteWith(new TypeError('Failed to fetch'));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(ru('settings_delete_account_error'), 'error'));
  });
});
