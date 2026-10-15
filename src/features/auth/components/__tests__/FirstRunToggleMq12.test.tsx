// MQ-12: переключатель «Это моё устройство» — цель нажатия 44 px по высоте, а подпись строки
// нажимается как сам переключатель (раньше подпись кнопкой не была).
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FirstRunFlow } from '../FirstRunStepper';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

vi.mock('react-router-dom', async () => ({ ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')), useNavigate: () => vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key, tp: (key: string, count: number) => `${key}:${count}`, language: 'ru' }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_stepper' }) }));
vi.mock('../PrivacyConsentBody', async (original) => ({ ...(await original<typeof import('../PrivacyConsentBody')>()), savePrivacyConsent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../../core/services/SyncService', () => ({ SyncService: { syncPending: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({ setRememberDevice: vi.fn() }));
vi.mock('../../../../core/crypto/keyVaultCache', () => ({ clearDeviceKey: vi.fn().mockResolvedValue(undefined) }));
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

describe('MQ-12: переключатель в мастере', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(STORAGE_KEYS.PENDING_RECOVERY_CODE('u_stepper'), 'abcd-ef01-2345-6789');
  });

  async function openCodeStep() {
    render(<Live />);
    fireEvent.click(screen.getByRole('checkbox', { name: /privacy_consent_required_label/ }));
    fireEvent.click(screen.getByRole('button', { name: /^privacy_modal_continue/ }));
    return screen.findByRole('switch', { name: 'enc_recovery_remember_device' });
  }

  it('кнопка-переключатель ростом 44 px, дорожка 24 px внутри неё', async () => {
    const sw = await openCodeStep();
    expect(sw.className).toMatch(/\bh-11\b/);
    expect(sw.className).toMatch(/\bw-12\b/);
    expect(sw.firstElementChild!.className).toMatch(/\bh-6\b/);
  });

  it('клик по тексту подписи переключает', async () => {
    const sw = await openCodeStep();
    const before = sw.getAttribute('aria-checked');
    fireEvent.click(screen.getByText('enc_recovery_remember_device', { selector: 'span' }));
    expect(sw.getAttribute('aria-checked')).not.toBe(before);
    expect(sw.closest('label')).not.toBeNull();
  });
});
