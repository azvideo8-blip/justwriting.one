// FT-1: отказ буфера обмена на кнопке «Скопировать код» показывал общий
// «Что-то пошло не так». Fable увидел это в e2e на компьютере (помощник жмёт
// «Скопировать», у тестового браузера буфер закрыт) и принял за ошибку первого
// входа. Теперь тост говорит, что делать. Оба входа: окно (компьютер) и степпер (телефон).
// Мутация: вернуть t('error_generic') в любом из двух мест — красный свой тест.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RecoveryCodeDisplayModal } from '../RecoveryCodeDisplayModal';
import { FirstRunFlow } from '../../../features/auth/components/FirstRunStepper';
import { STORAGE_KEYS } from '../../constants/storageKeys';

const showToast = vi.hoisted(() => vi.fn());
vi.mock('../Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../recoveryCodeActions', () => ({
  copyRecoveryCode: vi.fn().mockResolvedValue(false),
  downloadRecoveryCode: vi.fn().mockReturnValue(true),
}));
vi.mock('../../i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key, tp: (key: string) => key, language: 'ru' }),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_ft1' }) }));
vi.mock('../../../features/auth/components/PrivacyConsentBody', async (original) => {
  const actual = await original<typeof import('../../../features/auth/components/PrivacyConsentBody')>();
  return { ...actual, savePrivacyConsent: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../../../core/services/SyncService', () => ({ SyncService: { syncPending: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../../core/crypto/useEncryptionStore', () => ({ setRememberDevice: vi.fn() }));
vi.mock('../../../core/crypto/keyVaultCache', () => ({ clearDeviceKey: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../core/sync/useEmptyDeviceDetection', () => ({
  useEmptyDeviceDetection: () => ({ shouldPrompt: false, localCount: 0, cloudCount: 0, dismiss: vi.fn(), recheck: vi.fn() }),
}));

const copyFailedToast = () => expect(showToast).toHaveBeenCalledWith('enc_recovery_code_copy_failed', 'error');

describe('FT-1: отказ копирования кода говорит, что делать', () => {
  beforeEach(() => {
    cleanup();
    showToast.mockClear();
    sessionStorage.clear();
  });

  it('окно кода (компьютер)', async () => {
    render(<RecoveryCodeDisplayModal recoveryCode="abcd-ef01" onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /enc_recovery_code_copy_btn/ }));
    await waitFor(copyFailedToast);
    expect(showToast).not.toHaveBeenCalledWith('error_generic', 'error');
  });

  it('степпер первого входа (телефон)', async () => {
    sessionStorage.setItem(STORAGE_KEYS.PENDING_RECOVERY_CODE('u_ft1'), 'abcd-ef01-2345-6789');
    render(
      <MemoryRouter>
        <FirstRunFlow uid="u_ft1" showPrivacy={false} showConsent={false}
          onPrivacyDone={vi.fn()} onConsentDone={vi.fn()} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /enc_recovery_code_copy_btn/ }));
    await waitFor(copyFailedToast);
    expect(showToast).not.toHaveBeenCalledWith('error_generic', 'error');
  });
});
