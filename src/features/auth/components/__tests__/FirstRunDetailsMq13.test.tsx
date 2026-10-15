// MQ-13: мелочи мастера — счётчик «Шаг N из N» только при нескольких шагах, одна подпись кнопки
// на шагах 1 и 2 и подсказка под серой кнопкой шага с кодом, перенос кода между группами.
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
const cloud = vi.hoisted(() => ({ on: false }));
vi.mock('../../../../core/sync/useEmptyDeviceDetection', () => ({
  useEmptyDeviceDetection: () => ({ shouldPrompt: cloud.on, localCount: 0, cloudCount: 5, dismiss: vi.fn(), recheck: vi.fn() }),
}));

function Live({ privacyFirst = true, consent = false }: { privacyFirst?: boolean; consent?: boolean }) {
  const [privacy, setPrivacy] = useState(privacyFirst);
  return (
    <MemoryRouter>
      <FirstRunFlow uid="u_stepper" showPrivacy={privacy} showConsent={consent} onPrivacyDone={() => setPrivacy(false)} onConsentDone={vi.fn()} onOpenChange={vi.fn()} />
    </MemoryRouter>
  );
}

describe('MQ-13: мелочи мастера', () => {
  beforeEach(() => {
    cleanup();
    cloud.on = false;
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(STORAGE_KEYS.PENDING_RECOVERY_CODE('u_stepper'), 'abcd-ef01-2345-6789');
  });

  it('при нескольких шагах счётчик «Шаг 1 из N» на месте', () => {
    render(<Live />);
    expect(screen.getByTestId('first-run-step').textContent).toContain('first_run_step');
  });

  it('остался один шаг — счётчика нет', () => {
    sessionStorage.clear();
    cloud.on = true;
    render(<Live privacyFirst={false} consent />);
    expect(screen.getByText('first_run_cloud_title')).toBeInTheDocument();
    expect(screen.queryByTestId('first-run-step'), 'счётчик «Шаг 1 из 1»').toBeNull();
  });

  async function openCodeStep() {
    render(<Live />);
    fireEvent.click(screen.getByRole('checkbox', { name: /privacy_consent_required_label/ }));
    fireEvent.click(screen.getByRole('button', { name: /^privacy_modal_continue/ }));
    return screen.findByTestId('first-run-code');
  }

  it('код переносится между группами, а не внутри: каждая группа — неразрывный кусок', async () => {
    const code = await openCodeStep();
    expect(code.textContent).toBe('abcd-ef01-2345-6789');
    const groups = Array.from(code.querySelectorAll('span'));
    expect(groups.map(g => g.textContent)).toEqual(['abcd-', 'ef01-', '2345-', '6789']);
    for (const g of groups) expect(g.className).toContain('whitespace-nowrap');
    expect(code.querySelectorAll('wbr')).toHaveLength(3);
  });

  it('шаг с кодом: кнопка называется как на шаге 1, серая кнопка объясняет, чего не хватает', async () => {
    await openCodeStep();
    const next = screen.getByRole('button', { name: /^privacy_modal_continue/ });
    expect(next).toBeDisabled();
    expect(next.getAttribute('aria-describedby')).toBe('first-run-code-hint');
    expect(screen.getByTestId('first-run-code-hint').textContent).toBe('first_run_code_hint');
    fireEvent.click(screen.getByRole('checkbox', { name: /enc_recovery_code_confirm_checkbox/ }));
    expect(next).toBeEnabled();
    expect(screen.queryByTestId('first-run-code-hint')).toBeNull();
  });

  it('«Скопировать» и «Сохранить» не ломают подпись на две строки', async () => {
    await openCodeStep();
    for (const name of [/enc_recovery_code_copy_btn/, /enc_recovery_code_download_btn/]) {
      const b = screen.getByRole('button', { name });
      expect(b.className).toContain('whitespace-nowrap');
      expect(b.className).toContain('flex-1');
    }
  });
});
