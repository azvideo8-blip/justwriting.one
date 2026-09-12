import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { EncryptionPasswordModal } from '../EncryptionPasswordModal';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const mockRefreshProfile = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u1' }, profile: null, refreshProfile: mockRefreshProfile }),
}));

const initializeEncryption = vi.fn();
const migrateNotesAfterSetup = vi.fn().mockResolvedValue({ encrypted: 0, total: 0, errors: 0, success: true });
const mockShowToast = vi.fn();

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../../../core/services/EncryptionService', () => ({
  initializeEncryption: (...args: unknown[]) => initializeEncryption(...args),
  migrateNotesAfterSetup: (...args: unknown[]) => migrateNotesAfterSetup(...args),
  unlockVault: vi.fn(),
  recoverVaultWithCode: vi.fn(),
  changePassword: vi.fn(),
  VaultAlreadyExistsError: class VaultAlreadyExistsError extends Error {},
  WrongPasswordError: class WrongPasswordError extends Error {},
  WrongRecoveryCodeError: class WrongRecoveryCodeError extends Error {},
}));

// Сейф, заведённый из этого окна, раньше получал код восстановления, которого
// не видел никто: `handleSetup` вызывал `initializeEncryption` и выбрасывал
// возвращённый код.
describe('EncryptionPasswordModal, режим создания сейфа', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeEncryption.mockResolvedValue({ recoveryCode: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX' });
    migrateNotesAfterSetup.mockResolvedValue({ encrypted: 0, total: 0, errors: 0, success: true });
    mockRefreshProfile.mockClear();
  });

  const submitSetup = () => {
    const fields = screen.getAllByPlaceholderText(/enc_new_password_placeholder|enc_confirm_password/);
    expect(fields).toHaveLength(2);
    for (const field of fields) {
      fireEvent.change(field, { target: { value: 'password123' } });
    }
    fireEvent.click(screen.getByText('enc_setup_submit'));
  };

  it('показывает код восстановления и не зовёт onDone, пока не отмечена галочка', async () => {
    const onDone = vi.fn();
    render(<EncryptionPasswordModal mode="setup" userId="u1" onDone={onDone} />);

    submitSetup();

    await waitFor(() => {
      expect(screen.getByText('ABCD-EFGH-IJKL-MNOP-QRST-UVWX')).toBeTruthy();
    });
    expect(initializeEncryption).toHaveBeenCalledWith('u1', 'password123');
    expect(onDone).not.toHaveBeenCalled();

    // Кнопка «Продолжить» неактивна, пока человек не подтвердил, что сохранил код.
    const continueBtn = screen.getByText('enc_recovery_code_continue_btn').closest('button');
    expect(continueBtn?.disabled).toBe(true);
  });

  it('зовёт onDone только после подтверждения', async () => {
    const onDone = vi.fn();
    render(<EncryptionPasswordModal mode="setup" userId="u1" onDone={onDone} />);

    submitSetup();
    await waitFor(() => expect(screen.getByText('ABCD-EFGH-IJKL-MNOP-QRST-UVWX')).toBeTruthy());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('enc_recovery_code_continue_btn'));

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // TEST-1 §1.6: два клика в одном кадре — initializeEncryption ровно один
  // раз. Второй проход в противном случае перезаписал бы мету сейфа и
  // осиротил показанный код восстановления.
  it('двойной сабмит создания вызывает initializeEncryption один раз', async () => {
    let resolveInit: (v: { recoveryCode: string }) => void = () => {};
    initializeEncryption.mockImplementation(() => new Promise<{ recoveryCode: string }>(res => { resolveInit = res; }));

    const onDone = vi.fn();
    render(<EncryptionPasswordModal mode="setup" userId="u1" onDone={onDone} />);

    const fields = screen.getAllByPlaceholderText(/enc_new_password_placeholder|enc_confirm_password/);
    for (const field of fields) fireEvent.change(field, { target: { value: 'password123' } });

    const btn = screen.getByText('enc_setup_submit').closest('button')!;
    // Оба клика внутри ОДНОГО act: иначе React успевает применить
    // loading=true между ними, и тест проверяет disabled-кнопку, а не гвард
    // (ловушка «пустого теста» из тикета).
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    resolveInit({ recoveryCode: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX' });
    await waitFor(() => expect(screen.getByText('ABCD-EFGH-IJKL-MNOP-QRST-UVWX')).toBeTruthy());

    expect(initializeEncryption).toHaveBeenCalledTimes(1);
  });

  it('запускает шифрование существующих заметок после успешного создания сейфа', async () => {
    migrateNotesAfterSetup.mockResolvedValueOnce({ encrypted: 3, total: 3, errors: 0, success: true });
    render(<EncryptionPasswordModal mode="setup" userId="u1" onDone={vi.fn()} />);

    submitSetup();

    await waitFor(() => expect(migrateNotesAfterSetup).toHaveBeenCalledWith('u1'));
    expect(mockShowToast).toHaveBeenCalledWith('settings_encrypt_done', 'success');
  });

  it('при ошибках миграции показывает предупреждение о частичном шифровании, но оставляет сейф включённым', async () => {
    migrateNotesAfterSetup.mockResolvedValueOnce({ encrypted: 1, total: 2, errors: 1, success: false });
    render(<EncryptionPasswordModal mode="setup" userId="u1" onDone={vi.fn()} />);

    submitSetup();

    await waitFor(() => expect(migrateNotesAfterSetup).toHaveBeenCalledWith('u1'));
    expect(mockShowToast).toHaveBeenCalledWith('settings_encrypt_partial', 'error');
    // Код восстановления всё равно отображается: сейф включён
    expect(await screen.findByText('ABCD-EFGH-IJKL-MNOP-QRST-UVWX')).toBeTruthy();
  });

  it('обновляет профиль после настройки, чтобы раздел не показывал «Шифрование не настроено»', async () => {
    render(<EncryptionPasswordModal mode="setup" userId="u1" onDone={vi.fn()} />);

    submitSetup();

    // Профиль обновляется authoritative-запросом сразу после initializeEncryption,
    // иначе plашка настроек читает пустой profile.encryptionMeta из старого снапшота.
    await waitFor(() => expect(mockRefreshProfile).toHaveBeenCalledTimes(1));
  });
});
