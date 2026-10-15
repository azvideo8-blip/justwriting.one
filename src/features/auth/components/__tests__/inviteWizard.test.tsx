import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { InviteWizard } from '../InviteWizard';
import { updateUserPassword, getCurrentUser } from '../../../../core/auth/supabaseAuthProvider';
import { AuthService } from '../../services/AuthService';
import { DataProvider } from '../../../../core/data';
import { LanguageProvider } from '../../../../shared/i18n';

vi.mock('../../../../core/auth/supabaseAuthProvider', () => ({ updateUserPassword: vi.fn(async () => {}), getCurrentUser: vi.fn(() => null) }));
vi.mock('../../services/AuthService', () => ({ AuthService: { signInWithEmail: vi.fn() } }));
vi.mock('../../../../core/data', () => ({ DataProvider: { updateProfile: vi.fn(async () => {}) } }));

const UID = 'u-invite';

function renderWizard() {
  return render(
    <LanguageProvider>
    <MemoryRouter initialEntries={['/reset-password']}>
      <Routes>
        <Route path="/reset-password" element={<InviteWizard email="new@example.com" />} />
        <Route path="/" element={<div>EDITOR</div>} />
      </Routes>
    </MemoryRouter>
    </LanguageProvider>,
  );
}

async function throughPassword() {
  fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
  const next = () => screen.getByRole('button', { name: 'Далее' });
  expect(next()).toBeDisabled();                       // без обязательной галочки — нельзя
  fireEvent.click(screen.getAllByRole('checkbox')[0]!);
  fireEvent.click(next());
  // N-57: поля находятся по подписи, а не только по placeholder'у.
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'long-password-1' } });
  fireEvent.change(screen.getByLabelText('Повтори пароль'), { target: { value: 'long-password-1' } });
  fireEvent.click(next());
  await screen.findByText('Хранить заметки в облаке?');
}

// ON-1/ON-2: приглашение — мастер, после которого сразу редактор.
describe('InviteWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear(); sessionStorage.clear();
    vi.mocked(AuthService.signInWithEmail).mockImplementation(async () => {
      sessionStorage.setItem(`pending_recovery_code_${UID}`, 'ABCD-EFGH-IJKL');
      return { user: { uid: UID } } as never;
    });
  });

  it('back from the policy step returns to the welcome screen', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByText('Добро пожаловать в justwriting')).toBeTruthy();
  });

  it('sets the password, signs in (which creates the vault) and records consent', async () => {
    renderWizard();
    await throughPassword();
    expect(updateUserPassword).toHaveBeenCalledWith('long-password-1');
    expect(AuthService.signInWithEmail).toHaveBeenCalledWith('new@example.com', 'long-password-1');
    expect(DataProvider.updateProfile).toHaveBeenCalledWith(UID, expect.objectContaining({ privacyVersion: expect.any(Number), aiConsentAt: null }));
    expect(localStorage.getItem(`privacy_accepted_${UID}`)).not.toBeNull();
  });

  it('«Не сейчас» leaves sync off, asks nothing later and drops the pending code', async () => {
    renderWizard();
    await throughPassword();
    fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }));
    await screen.findByText('EDITOR');
    expect(localStorage.getItem(`auto_sync_enabled_${UID}`)).toBe('false');
    expect(localStorage.getItem(`auto_sync_asked_${UID}`)).toBe('true');
    expect(sessionStorage.getItem(`pending_recovery_code_${UID}`)).toBeNull();
  });

  it('«Включить» shows the recovery code once, then the editor with sync on', async () => {
    renderWizard();
    await throughPassword();
    fireEvent.click(screen.getByRole('button', { name: 'Включить' }));
    expect(screen.getByText('ABCD-EFGH-IJKL')).toBeTruthy();
    const start = screen.getByRole('button', { name: 'Начать писать' });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByText('EDITOR')).toBeTruthy());
    expect(localStorage.getItem(`auto_sync_enabled_${UID}`)).toBe('true');
    expect(sessionStorage.getItem(`pending_recovery_code_${UID}`)).toBeNull();
  });
});

// 2026-10-05: приглашённый видел «нет сети», когда на деле потерялся вход по ссылке.
describe('InviteWizard password errors say what actually happened', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); });

  async function failWith(err: unknown) {
    vi.mocked(updateUserPassword).mockRejectedValueOnce(err);
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'long-password-1' } });
    fireEvent.change(screen.getByLabelText('Повтори пароль'), { target: { value: 'long-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
  }

  it('a lost link session is named as such, not as a network failure', async () => {
    await failWith(new Error('No signed-in user to set a password for'));
    expect(await screen.findByText(/Вход по ссылке потерялся/)).toBeTruthy();
    expect(screen.queryByText(/Нет соединения с сетью/)).toBeNull();
  });

  it('a request that never left the browser is a network failure', async () => {
    await failWith(new TypeError('Failed to fetch'));
    expect(await screen.findByText(/Нет соединения с сетью/)).toBeTruthy();
  });

  it('the policy links open in a new tab, so the wizard is not left behind', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a.getAttribute('target')).toBe('_blank');
  });
});

// V-1.1: перезагрузка страницы посреди мастера начинала его заново и теряла
// галочки согласия (memory f3-account-switch-findings).
describe('InviteWizard continues after a reload', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); });

  function renderAt(tokenHash: string) {
    return render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/reset-password']}>
          <Routes>
            <Route path="/reset-password" element={<InviteWizard email="new@example.com" tokenHash={tokenHash} />} />
            <Route path="/" element={<div>EDITOR</div>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );
  }

  function toPasswordStep(boxes: { policy: boolean; aiConsent: boolean }) {
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    if (boxes.policy) fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    if (boxes.aiConsent) fireEvent.click(screen.getAllByRole('checkbox')[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
  }

  it('a reload on the password step lands on the password step with both boxes ticked', () => {
    const first = renderAt('tok-reload');
    toPasswordStep({ policy: true, aiConsent: true });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'typed-but-not-sent' } });
    first.unmount();

    renderAt('tok-reload');
    expect(screen.getByText('Придумай пароль')).toBeTruthy();
    expect(screen.queryByText('Добро пожаловать в justwriting')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
    expect(screen.getAllByRole('checkbox')[1]).toBeChecked();
    // Пароль в хранилище не попадает — только шаги и галочки.
    const stored = Array.from({ length: sessionStorage.length }, (_, i) => `${sessionStorage.key(i)}=${sessionStorage.getItem(sessionStorage.key(i) ?? '')}`).join('|');
    expect(stored).toContain('jw_invite_wizard_tok-reload');
    expect(stored).not.toContain('typed-but-not-sent');
  });

  it('another link starts its own wizard from the beginning', () => {
    const first = renderAt('tok-one');
    toPasswordStep({ policy: true, aiConsent: false });
    first.unmount();

    renderAt('tok-two');
    expect(screen.getByText('Добро пожаловать в justwriting')).toBeTruthy();
  });

  it('the sync step is restored for the person who is already signed in', async () => {
    vi.mocked(AuthService.signInWithEmail).mockImplementation(async () => ({ user: { uid: UID } }) as never);
    vi.mocked(getCurrentUser).mockReturnValue({ uid: UID, email: 'new@example.com' } as never);
    const first = renderAt('tok-sync');
    toPasswordStep({ policy: true, aiConsent: false });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'long-password-1' } });
    fireEvent.change(screen.getByLabelText('Повтори пароль'), { target: { value: 'long-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    await screen.findByText('Хранить заметки в облаке?');
    first.unmount();

    renderAt('tok-sync');
    expect(await screen.findByText('Хранить заметки в облаке?')).toBeTruthy();
    expect(screen.queryByText('Придумай пароль')).toBeNull();
  });

  it('a guest session does not inherit the sync step', () => {
    sessionStorage.setItem('jw_invite_wizard_tok-guest', JSON.stringify({ step: 'sync', policy: true, aiConsent: false }));
    vi.mocked(getCurrentUser).mockReturnValue({ uid: 'guest-1', email: null } as never);
    renderAt('tok-guest');
    expect(screen.getByText('Придумай пароль')).toBeTruthy();
  });

  it('finishing the wizard drops the saved progress', async () => {
    vi.mocked(AuthService.signInWithEmail).mockImplementation(async () => ({ user: { uid: UID } }) as never);
    const first = renderAt('tok-finish');
    toPasswordStep({ policy: true, aiConsent: false });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'long-password-1' } });
    fireEvent.change(screen.getByLabelText('Повтори пароль'), { target: { value: 'long-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    await screen.findByText('Хранить заметки в облаке?');
    fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }));
    await screen.findByText('EDITOR');
    expect(sessionStorage.getItem('jw_invite_wizard_tok-finish')).toBeNull();
    first.unmount();
  });
});
