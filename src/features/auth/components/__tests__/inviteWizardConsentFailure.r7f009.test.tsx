// R7F-009: сбой записи согласия после успешной смены пароля оставлял мастера на
// шаге пароля. Один `catch` на три шага (`updateUserPassword` → `signInWithEmail`
// → `savePrivacyConsent`), а к моменту сбоя сессия и сейф уже созданы: человек
// видит «не удалось» и жмёт тем же паролем → GoTrue отвечает `same_password` 422
// (тупик), а другой пароль оставляет сейф, обёрнутый вокруг ПЕРВОГО пароля, —
// при следующем входе он не откроется.
//
// Правка: сбой согласия после доказанного входа не возвращает человека на шаг
// пароля, а ведёт к шагу облака; вопрос политики остаётся гейту на «/».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { InviteWizard } from '../InviteWizard';
import { updateUserPassword } from '../../../../core/auth/supabaseAuthProvider';
import { AuthService } from '../../services/AuthService';
import { savePrivacyConsent } from '../PrivacyConsentBody';
import { reportError } from '../../../../shared/errors/reportError';
import { LanguageProvider } from '../../../../shared/i18n';

vi.mock('../../../../core/auth/supabaseAuthProvider', () => ({
  updateUserPassword: vi.fn(async () => {}),
  getCurrentUser: vi.fn(() => null),
}));
vi.mock('../../services/AuthService', () => ({ AuthService: { signInWithEmail: vi.fn() } }));
vi.mock('../../../../core/data', () => ({ DataProvider: { updateProfile: vi.fn(async () => {}) } }));
vi.mock('../PrivacyConsentBody', async (orig) => {
  const actual = await orig<typeof import('../PrivacyConsentBody')>();
  return { ...actual, savePrivacyConsent: vi.fn(async () => {}) };
});
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const UID = 'u-r7f009';

function renderWizard() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/reset-password']}>
        <Routes>
          <Route path="/reset-password" element={<InviteWizard email="person@example.com" />} />
          <Route path="/" element={<div>EDITOR</div>} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

async function fillPassword() {
  fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
  const next = () => screen.getByRole('button', { name: 'Далее' });
  fireEvent.click(screen.getAllByRole('checkbox')[0]!);
  fireEvent.click(next());
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'long-password-1' } });
  fireEvent.change(screen.getByLabelText('Повтори пароль'), { target: { value: 'long-password-1' } });
  fireEvent.click(next());
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks не снимает mockRejectedValue из предыдущего кейса — реализацию
  // возврата надо задавать заново каждым beforeEach, иначе отказ течёт сквозь тесты.
  vi.mocked(updateUserPassword).mockResolvedValue(undefined as never);
  localStorage.clear();
  sessionStorage.clear();
  // Как при настоящем входе: signInWithEmail тихо создаёт сейф и оставляет код.
  vi.mocked(AuthService.signInWithEmail).mockImplementation(async () => {
    sessionStorage.setItem(`pending_recovery_code_${UID}`, 'ABCD-EFGH-IJKL');
    return { user: { uid: UID } } as never;
  });
  vi.mocked(savePrivacyConsent).mockResolvedValue(undefined as never);
});

afterEach(cleanup);

describe('R7F-009: сбой согласия не запихивает обратно на шаг пароля', () => {
  it('согласие не записалось, а вход и сейф уже есть — мастер идёт к шагу облака', async () => {
    vi.mocked(savePrivacyConsent).mockRejectedValue(new Error('PATCH /rest/v1/users 500'));
    renderWizard();
    await fillPassword();

    expect(await screen.findByText('Хранить заметки в облаке?'),
      'сбой согласия оставил человека на шаге пароля').toBeInTheDocument();
    expect(screen.queryByText(/не удалось/i), 'показано «не удалось» там, где сессия уже есть').toBeNull();
    expect(updateUserPassword).toHaveBeenCalledTimes(1);
    expect(reportError, 'сбой согласия обязан быть в журнале').toHaveBeenCalled();
  });

  it('обычный путь без сбоя согласия не изменился', async () => {
    renderWizard();
    await fillPassword();
    await screen.findByText('Хранить заметки в облаке?');
    expect(savePrivacyConsent).toHaveBeenCalledTimes(1);
  });

  it('сбой самой смены пароля по-прежнему остаётся на шаге пароля с причиной', async () => {
    vi.mocked(updateUserPassword).mockRejectedValue(new Error('401 session expired'));
    renderWizard();
    await fillPassword();

    expect(await screen.findByRole('button', { name: 'Далее' })).toBeInTheDocument();
    expect(screen.queryByText('Хранить заметки в облаке?')).toBeNull();
    expect(AuthService.signInWithEmail, 'вход не должен случиться после отказа смены пароля').not.toHaveBeenCalled();
  });

  it('сбой входа тоже остаётся на шаге пароля: согласия не было и сейфа нет', async () => {
    vi.mocked(AuthService.signInWithEmail).mockRejectedValue(new Error('invalid credentials'));
    renderWizard();
    await fillPassword();

    expect(await screen.findByRole('button', { name: 'Далее' })).toBeInTheDocument();
    expect(screen.queryByText('Хранить заметки в облаке?')).toBeNull();
    expect(savePrivacyConsent).not.toHaveBeenCalled();
  });

  it('после сбоя согласия шаг облака доживает до конца мастера', async () => {
    vi.mocked(savePrivacyConsent).mockRejectedValue(new Error('PATCH failed'));
    renderWizard();
    await fillPassword();
    await screen.findByText('Хранить заметки в облаке?');

    fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }));
    expect(await screen.findByText('Сохрани код восстановления')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Хранить заметки в облаке?')).toBeNull());
  });
});
