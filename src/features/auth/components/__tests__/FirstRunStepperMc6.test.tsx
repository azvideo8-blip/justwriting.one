// MC-6: первый вход на телефоне — три полноэкранных шага вместо стопа окон.
// Проверяется то, что юридическая суть не изменилась: тот же вызов
// `savePrivacyConsent`, те же ключи `AUTO_SYNC_*`, код требует подтверждения,
// `role=dialog` на экране нет вовсе, а десктоп остаётся на старых окнах.
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FirstRunFlow } from '../FirstRunStepper';
import { decideFirstRunShell } from '../../../../app/firstRunShell';
import { savePrivacyConsent } from '../PrivacyConsentBody';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

// Шаг «Облако» нужен и когда на другом устройстве есть что забирать, поэтому
// количество и сам вопрос подкручиваются по тесту.
const cloudPrompt = vi.hoisted(() => ({ on: true, count: 59 }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key} ${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(' ')}` : key,
    tp: (key: string, count: number) => `${key}:${count}`,
    language: 'ru',
  }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_stepper' }) }));
vi.mock('../PrivacyConsentBody', async (original) => {
  const actual = await original<typeof import('../PrivacyConsentBody')>();
  return { ...actual, savePrivacyConsent: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../../../../core/services/SyncService', () => ({ SyncService: { syncPending: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({ setRememberDevice: vi.fn() }));
vi.mock('../../../../core/crypto/keyVaultCache', () => ({ clearDeviceKey: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../../core/sync/useEmptyDeviceDetection', () => ({
  useEmptyDeviceDetection: () => ({ shouldPrompt: cloudPrompt.on, localCount: 0, cloudCount: cloudPrompt.count, dismiss: vi.fn(), recheck: vi.fn() }),
}));

const saveMock = savePrivacyConsent as unknown as ReturnType<typeof vi.fn>;

function renderFlow(shows: { privacy?: boolean; consent?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <FirstRunFlow
        uid="u_stepper"
        showPrivacy={shows.privacy ?? true}
        showConsent={shows.consent ?? true}
        onPrivacyDone={vi.fn()}
        onConsentDone={vi.fn()}
        onOpenChange={vi.fn()}
      />
    </MemoryRouter>,
  );
}

/** Как в приложении: родитель снимает флаги, когда шаг отвечен. Фиксированные
 *  флаги (renderFlow) прятали проскок кода восстановления. */
function LiveFlow({ consent = true, onOpenChange = vi.fn() }: { consent?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [privacy, setPrivacy] = useState(true);
  const [askConsent, setAskConsent] = useState(consent);
  return (
    <MemoryRouter>
      <FirstRunFlow
        uid="u_stepper"
        showPrivacy={privacy}
        showConsent={askConsent}
        onPrivacyDone={() => setPrivacy(false)}
        onConsentDone={() => setAskConsent(false)}
        onOpenChange={onOpenChange}
      />
    </MemoryRouter>
  );
}

async function passPolicy() {
  fireEvent.click(screen.getByRole('checkbox', { name: /privacy_consent_required_label/ }));
  fireEvent.click(screen.getByRole('button', { name: /^privacy_modal_continue/ }));
}

describe('MC-6: чем отвечать на первый вход', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    saveMock.mockClear();
    sessionStorage.setItem(STORAGE_KEYS.PENDING_RECOVERY_CODE('u_stepper'), 'abcd-ef01-2345-6789');
  });

  it('решение: телефон с правом — степпер, десктоп — окна, без ответа — пауза', () => {
    const on = { stepperEnabled: true };
    expect(decideFirstRunShell({ ...on, mobileLayout: true, mobilePreferred: true, accessAnswered: true, timedOut: false })).toBe('stepper');
    expect(decideFirstRunShell({ ...on, mobileLayout: false, mobilePreferred: false, accessAnswered: true, timedOut: false })).toBe('dialogs');
    expect(decideFirstRunShell({ ...on, mobileLayout: false, mobilePreferred: true, accessAnswered: false, timedOut: false })).toBe('hold');
    expect(decideFirstRunShell({ ...on, mobileLayout: false, mobilePreferred: true, accessAnswered: false, timedOut: true })).toBe('dialogs');
  });

  // Ревью 0.9.40: после правки очереди степпер включён по умолчанию.
  // Мутация: FIRST_RUN_STEPPER_ENABLED = false → красный.
  it('включён по умолчанию: телефон с правом — степпер', () => {
    expect(decideFirstRunShell({ mobileLayout: true, mobilePreferred: true, accessAnswered: true, timedOut: false })).toBe('stepper');
  });

  it('шаг 1: ни одного окна, «Продолжить» не активна без обязательной галочки', async () => {
    renderFlow();
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(screen.getByText('first_run_policy_title')).toBeInTheDocument();

    const next = screen.getByRole('button', { name: /^privacy_modal_continue/ });
    expect(next).toBeDisabled();
    fireEvent.click(next);
    expect(saveMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: /privacy_consent_required_label/ }));
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith('u_stepper', false));
  });

  it('шаг 2 требует подтверждения и копает код, шаг 3 пишет AUTO_SYNC_*', async () => {
    renderFlow();
    fireEvent.click(screen.getByRole('checkbox', { name: /privacy_consent_required_label/ }));
    fireEvent.click(screen.getByRole('button', { name: /^privacy_modal_continue/ }));

    expect(await screen.findByText('enc_recovery_code_title')).toBeInTheDocument();
    expect(screen.getByTestId('first-run-code').textContent).toBe('abcd-ef01-2345-6789');
    const further = screen.getByRole('button', { name: /^first_run_next/ });
    expect(further).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /enc_recovery_code_confirm_checkbox/ }));
    await waitFor(() => expect(further).toBeEnabled());
    fireEvent.click(further);

    expect(await screen.findByText('first_run_cloud_title')).toBeInTheDocument();
    // 59 заметок в облаке — вопрос о загрузке появляется.
    expect(screen.getByRole('switch', { name: /first_run_restore_switch:59/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^first_run_finish/ }));
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('u_stepper'))).toBe('true'));
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ASKED('u_stepper'))).toBe('true');
    expect(navigate).toHaveBeenCalledWith('/');
    // «Пропустить» больше не нужен: ответ записан, вопрос не повторится.
    expect(sessionStorage.getItem(STORAGE_KEYS.PENDING_RECOVERY_CODE('u_stepper'))).toBeNull();
  });

  it('один шаг остаётся одним шагом: счётчик не врал про «из 3»', () => {
    sessionStorage.clear();
    cloudPrompt.on = false;
    renderFlow({ privacy: true, consent: false });
    expect(screen.getByTestId('first-run-step').textContent).toContain('total=1');
    cloudPrompt.on = true;
  });

  // Ревью 0.9.40. Мутации: строить очередь без пройденных шагов → красный первый
  // кейс; шаг «Облако» и при одном shouldPrompt → красный третий; убрать
  // трансграничную строку → красный четвёртый.
  it('живая очередь: политика 1/3 → код 2/3 → облако 3/3, код не проскакивает', async () => {
    render(<LiveFlow />);
    expect(screen.getByTestId('first-run-step').textContent).toContain('current=1 total=3');
    await passPolicy();
    expect(await screen.findByText('enc_recovery_code_title')).toBeInTheDocument();
    expect(screen.getByTestId('first-run-step').textContent).toContain('current=2 total=3');
    fireEvent.click(screen.getByRole('checkbox', { name: /enc_recovery_code_confirm_checkbox/ }));
    fireEvent.click(screen.getByRole('button', { name: /^first_run_next/ }));
    expect(await screen.findByText('first_run_cloud_title')).toBeInTheDocument();
    expect(screen.getByTestId('first-run-step').textContent).toContain('current=3 total=3');
  });

  it('загрузка из облака: «Начать писать» закрывает мастер, а не показывает «Облако» снова', async () => {
    const onOpenChange = vi.fn();
    render(<LiveFlow onOpenChange={onOpenChange} />);
    await passPolicy();
    fireEvent.click(await screen.findByRole('checkbox', { name: /enc_recovery_code_confirm_checkbox/ }));
    fireEvent.click(screen.getByRole('button', { name: /^first_run_next/ }));
    await screen.findByText('first_run_cloud_title');
    expect(screen.getByRole('switch', { name: /first_run_restore_switch:59/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /^first_run_finish/ }));
    await waitFor(() => expect(screen.queryByTestId('first-run-stepper')).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('вопрос о синхронизации уже отвечен: мастер её не трогает и «Облако» не показывает', () => {
    sessionStorage.clear();
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('u_stepper'), 'false');
    renderFlow({ privacy: false, consent: false });
    expect(screen.queryByTestId('first-run-stepper')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('u_stepper'))).toBe('false');
  });

  it('шаг 1 сразу говорит, что запросы могут уйти поставщику за рубежом', () => {
    renderFlow();
    expect(screen.getByText('privacy_consent_third_party_p2')).toBeInTheDocument();
  });
});
