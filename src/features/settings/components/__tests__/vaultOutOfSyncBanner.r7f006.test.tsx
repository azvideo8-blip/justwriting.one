import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VaultOutOfSyncBanner } from '../VaultOutOfSyncBanner';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import { EncryptionService } from '../../../../core/services/EncryptionService';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { LanguageProvider } from '../../../../shared/i18n';

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ refreshProfile: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

// R7F-006: после сброса пароля по почте запомненное устройство молча держит сейф
// на прежнем пароле — вход новым паролем не развернул обёртку (`AuthService` ставит
// флаг), а `useEncryptionSetup` открыл сейф ключом из кэша. Здесь только видимое
// уведомление и выпуск кода: перешифровка сейфа — отдельный тикет с разрешением
// владельца, формат ключей в этом пакете не меняется.
const UID = 'u-r7f006';
const generateCode = vi.spyOn(EncryptionService, 'generateRecoveryCodeForExistingVault');

function renderBanner() {
  return render(<LanguageProvider><VaultOutOfSyncBanner userId={UID} /></LanguageProvider>);
}

describe('R7F-006: плашка «сейф на прежнем пароле»', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    useEncryptionStore.getState().setKey({ extractable: true } as unknown as CryptoKey);
  });

  afterEach(() => {
    useEncryptionStore.getState().setKey(null);
  });

  it('флаг стоит и сейф открыт — плашка видна', () => {
    sessionStorage.setItem(STORAGE_KEYS.VAULT_AUTO_UNLOCK_FAILED(UID), '1');
    renderBanner();
    expect(screen.getByText(/сейф всё ещё на прежнем пароле/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /создать код восстановления/i })).toBeInTheDocument();
  });

  it('флаг снят — плашки нет', () => {
    renderBanner();
    expect(screen.queryByText(/сейф всё ещё на прежнем пароле/i)).toBeNull();
  });

  it('сейф заперт — плашки нет: открывать будет модалка по паролю', () => {
    sessionStorage.setItem(STORAGE_KEYS.VAULT_AUTO_UNLOCK_FAILED(UID), '1');
    useEncryptionStore.getState().setKey(null);
    renderBanner();
    expect(screen.queryByText(/сейф всё ещё на прежнем пароле/i)).toBeNull();
  });

  it('выпуск кода идёт без пароля, пока ключ устройства выгружаемый', async () => {
    sessionStorage.setItem(STORAGE_KEYS.VAULT_AUTO_UNLOCK_FAILED(UID), '1');
    generateCode.mockResolvedValue('ABCD-EFGH-IJKL');
    renderBanner();

    fireEvent.click(screen.getByRole('button', { name: /создать код восстановления/i }));

    await waitFor(() => expect(screen.getByText('ABCD-EFGH-IJKL')).toBeInTheDocument());
    expect(generateCode).toHaveBeenCalledWith(UID);
  });

  it('невывгружаемый ключ — говорится, что нужен прежний пароль сейфа', async () => {
    sessionStorage.setItem(STORAGE_KEYS.VAULT_AUTO_UNLOCK_FAILED(UID), '1');
    generateCode.mockRejectedValue(new EncryptionService.KeyNotExtractableError());
    renderBanner();

    fireEvent.click(screen.getByRole('button', { name: /создать код восстановления/i }));

    expect(await screen.findByText(/код выпускается по прежнему паролю сейфа/i)).toBeInTheDocument();
    expect(screen.getByText(/сейф всё ещё на прежнем пароле/i)).toBeInTheDocument();
  });
});
