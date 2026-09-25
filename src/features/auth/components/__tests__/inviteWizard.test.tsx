import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { InviteWizard } from '../InviteWizard';
import { updateUserPassword } from '../../../../core/auth/supabaseAuthProvider';
import { AuthService } from '../../services/AuthService';
import { DataProvider } from '../../../../core/data';
import { LanguageProvider } from '../../../../shared/i18n';

vi.mock('../../../../core/auth/supabaseAuthProvider', () => ({ updateUserPassword: vi.fn(async () => {}) }));
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
  fireEvent.change(screen.getByPlaceholderText('Пароль'), { target: { value: 'long-password-1' } });
  fireEvent.change(screen.getByPlaceholderText('Повторите пароль'), { target: { value: 'long-password-1' } });
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
