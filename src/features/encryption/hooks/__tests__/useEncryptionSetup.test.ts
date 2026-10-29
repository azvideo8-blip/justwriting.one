import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mockUser = { uid: 'user-a' };
// A profile that still carries the legacy fields — i.e. hasLegacyEncryption()
// is true, which is what used to be enough to demand migration.
const legacyProfile = { encryptionSalt: 'salt', encryptedDataKey: 'wrapped' };
let currentProfile: unknown = legacyProfile;

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: mockUser, profile: currentProfile }),
}));

const isVaultUnlocked = vi.fn(() => false);
vi.mock('../../../../core/crypto/encrypt', () => ({
  isVaultUnlocked: () => isVaultUnlocked(),
  setSessionKey: vi.fn(),
  decryptContent: vi.fn(),
}));

let storeUnlocked = false;
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: (sel: (s: unknown) => unknown) => sel({ isVaultUnlocked: storeUnlocked }),
  setRememberDevice: vi.fn(),
  isLockedByIdle: () => false,
}));

vi.mock('../../../../core/crypto/keyVaultCache', () => ({
  loadDeviceKey: vi.fn().mockResolvedValue(null),
  clearDeviceKey: vi.fn(),
}));

vi.mock('../../../../core/crypto/cryptoHelpers', () => ({ setEncryptionEnabled: vi.fn() }));

const hasEncryptionMeta = vi.fn();
vi.mock('../../../../core/services/EncryptionMetaService', () => ({
  hasEncryptionMeta: () => hasEncryptionMeta(),
  getEncryptionMeta: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../core/services/LegacyKeyMigration', () => ({
  hasLegacyEncryption: (p: unknown) => Boolean(p),
}));

const reportError = vi.fn();
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { useEncryptionSetup } from '../useEncryptionSetup';

describe('useEncryptionSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isVaultUnlocked.mockReturnValue(false);
    storeUnlocked = false;
    currentProfile = legacyProfile;
  });

  // Вход открывает сейф паролем уже после события смены пользователя: check()
  // успевал выбрать «unlock», и окно висело над открытым сейфом.
  it('closes the unlock prompt once sign-in unlocks the vault', async () => {
    hasEncryptionMeta.mockResolvedValue(true);
    const { result, rerender } = renderHook(() => useEncryptionSetup());
    await waitFor(() => expect(result.current.mode).toBe('unlock'));

    isVaultUnlocked.mockReturnValue(true);
    storeUnlocked = true;
    rerender();
    expect(result.current.mode).toBe('none');
  });

  /**
   * The read tells us whether this vault already migrated. When it fails we do
   * not know — and offering migration then is fail-dangerous: a Firestore
   * outage presented an irreversible key re-wrap to a user whose vault was
   * fine, in a modal with no exit.
   */
  // EA-16: сейфа нет вовсе (автосоздание при входе не удалось) — без него в
  // облако ничего не уходит, поэтому приложение сразу предлагает его создать.
  it('offers vault setup when the account has no vault at all', async () => {
    currentProfile = null; // мок hasLegacyEncryption: пустой профиль = старого сейфа нет
    hasEncryptionMeta.mockResolvedValue(false);

    const { result } = renderHook(() => useEncryptionSetup());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe('setup');
  });

  it('does not demand migration when the encryptionMeta read fails', async () => {
    hasEncryptionMeta.mockRejectedValue(new Error('resource-exhausted'));

    const { result } = renderHook(() => useEncryptionSetup());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe('none');
    expect(reportError).toHaveBeenCalled();
  });

  it('still demands migration when the read succeeds and says there is no new metadata', async () => {
    hasEncryptionMeta.mockResolvedValue(false);

    const { result } = renderHook(() => useEncryptionSetup());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe('migrate');
  });

  it('can be dismissed, so the prompt is never a trap', async () => {
    hasEncryptionMeta.mockResolvedValue(false);

    const { result } = renderHook(() => useEncryptionSetup());
    await waitFor(() => expect(result.current.mode).toBe('migrate'));

    act(() => { result.current.dismiss(); });
    expect(result.current.mode).toBe('none');
  });

  /**
   * D-2: кнопка «Разблокировать» в предпросмотре запертой заметки и «Продолжить»
   * в тосте «Заметка заперта» шлют window-событие 'open-vault-unlock'. Слушателей
   * не было ни одного, поэтому кнопка не делала ничего. AppShell рендерит
   * EncryptionPasswordModal при любом mode !== 'none' (см. AppShell.tsx), модалка
   * mode='unlock' покрыта её собственными тестами.
   */
  it('opens the unlock prompt on the open-vault-unlock event while locked', async () => {
    hasEncryptionMeta.mockRejectedValue(new Error('meta read failed'));

    const { result } = renderHook(() => useEncryptionSetup());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe('none');

    act(() => { window.dispatchEvent(new CustomEvent('open-vault-unlock')); });
    expect(result.current.mode).toBe('unlock');
  });

  it('ignores open-vault-unlock when the vault is already unlocked', async () => {
    isVaultUnlocked.mockReturnValue(true);
    hasEncryptionMeta.mockResolvedValue(true);

    const { result } = renderHook(() => useEncryptionSetup());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe('none');

    act(() => { window.dispatchEvent(new CustomEvent('open-vault-unlock')); });
    expect(result.current.mode).toBe('none');
  });
});
