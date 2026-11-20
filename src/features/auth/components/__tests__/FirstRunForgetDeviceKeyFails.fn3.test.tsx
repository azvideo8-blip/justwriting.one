// FN-3 (дейлик 20.11, Н-3): в мастере первого входа снятый «запомнить устройство» —
// отказ стирания ключа устройства называется тостом ошибки, а не молчит.
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FirstRunFlow } from '../FirstRunStepper';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

const showToast = vi.hoisted(() => vi.fn());
const clearDeviceKey = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => ({ ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')), useNavigate: () => vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key, tp: (key: string, count: number) => `${key}:${count}`, language: 'ru' }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_stepper' }) }));
vi.mock('../PrivacyConsentBody', async (original) => ({ ...(await original<typeof import('../PrivacyConsentBody')>()), savePrivacyConsent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../../core/services/SyncService', () => ({ SyncService: { syncPending: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({ setRememberDevice: vi.fn() }));
vi.mock('../../../../core/crypto/keyVaultCache', () => ({ clearDeviceKey }));
vi.mock('../../../../core/sync/useEmptyDeviceDetection', () => ({
  useEmptyDeviceDetection: () => ({ shouldPrompt: false, localCount: 0, cloudCount: 0, dismiss: vi.fn(), recheck: vi.fn() }),
}));

function Live() {
  const [privacy, setPrivacy] = useState(true);
  return (
    <MemoryRouter>
      <FirstRunFlow uid="u_stepper" showPrivacy={privacy} showConsent={false} onPrivacyDone={() => setPrivacy(false)} onConsentDone={vi.fn()} onOpenChange={vi.fn()} />
    </MemoryRouter>
  );
}

async function untickAndContinue() {
  render(<Live />);
  fireEvent.click(screen.getByRole('checkbox', { name: /privacy_consent_required_label/ }));
  fireEvent.click(screen.getByRole('button', { name: /^privacy_modal_continue/ }));
  fireEvent.click(await screen.findByRole('switch', { name: 'enc_recovery_remember_device' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /enc_recovery_code_confirm_checkbox/ }));
  fireEvent.click(screen.getByRole('button', { name: /^privacy_modal_continue/ }));
}

describe('FN-3: мастер первого входа — итог снятия «запомнить устройство»', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(STORAGE_KEYS.PENDING_RECOVERY_CODE('u_stepper'), 'abcd-ef01-2345-6789');
  });

  it('отказ clearDeviceKey — тост ошибки', async () => {
    clearDeviceKey.mockRejectedValue(new Error('MARKER_IDB_DOWN'));
    await untickAndContinue();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('settings_vault_lock_device_key_failed', 'error'));
  });

  it('КОНТРОЛЬ: ключ стёрт — без тоста ошибки', async () => {
    clearDeviceKey.mockResolvedValue(undefined);
    await untickAndContinue();
    await waitFor(() => expect(clearDeviceKey).toHaveBeenCalledWith('u_stepper'));
    await new Promise(r => setTimeout(r, 0));
    expect(showToast).not.toHaveBeenCalled();
  });
});
