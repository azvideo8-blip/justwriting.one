// MQ-6: смена шага мастера при «Уменьшить движение» — без бокового сдвига (позиционный ключ `x`).
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
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
    <MotionConfig reducedMotion="always">
      <MemoryRouter>
        <FirstRunFlow uid="u_stepper" showPrivacy={privacy} showConsent={false} onPrivacyDone={() => setPrivacy(false)} onConsentDone={vi.fn()} onOpenChange={vi.fn()} />
      </MemoryRouter>
    </MotionConfig>
  );
}

describe('MQ-6: шаги мастера при reduced motion', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(STORAGE_KEYS.PENDING_RECOVERY_CODE('u_stepper'), 'abcd-ef01-2345-6789');
  });

  it('следующий шаг на месте сразу, без сдвига на 16 px', async () => {
    render(<Live />);
    fireEvent.click(screen.getByRole('checkbox', { name: /privacy_consent_required_label/ }));
    fireEvent.click(screen.getByRole('button', { name: /^privacy_modal_continue/ }));
    const step = await screen.findByTestId('first-run-code');
    await act(() => new Promise<void>(r => setTimeout(r, 60)));
    const el = step.closest('[data-stepper-step]') as HTMLElement;
    expect(/^(|none|translate[XY]\(0(px|%)?\)|matrix\(1, 0, 0, 1, 0, 0\))$/.test(el.style.transform.trim()), `transform=${el.style.transform}`).toBe(true);
  });
});
