import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

/**
 * Флаг encryptionEnabled решает, шифровать ли заметку перед отправкой в облако
 * (maybeEncrypt читает именно его). Поэтому снимать флаг можно только по
 * положительному сигналу «сейфа нет», а не по снапшоту, в котором поля просто
 * не оказалось: логическая репликация не присылает неизменённые TOAST-значения,
 * так что encryption_meta может отсутствовать в payload у аккаунта с сейфом.
 * Снятый на этом флаг означал бы заметки в облаке открытым текстом.
 */

let capturedOnUpdate: ((data: unknown) => void) | null = null;
const mockGetProfile = vi.fn();
vi.mock('../../../core/data', () => ({
  DataProvider: {
    subscribeToProfile: (_uid: string, onUpdate: (data: unknown) => void) => {
      capturedOnUpdate = onUpdate;
      return () => { capturedOnUpdate = null; };
    },
    getProfile: (...args: unknown[]) => mockGetProfile(...args),
    updateProfile: vi.fn().mockResolvedValue(undefined),
  },
}));

const setEncryptionEnabled = vi.fn();
vi.mock('../../../core/crypto/cryptoHelpers', () => ({
  setEncryptionEnabled: (uid: string, on: boolean) => setEncryptionEnabled(uid, on),
  setProfileLoaded: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user-1', email: 'a@b.c', displayName: 'A' } }),
}));

const { ProfileProvider } = await import('../contexts/ProfileContext');

function mount() {
  render(<ProfileProvider><div /></ProfileProvider>);
}

describe('ProfileContext and the encryptionEnabled flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnUpdate = null;
    mockGetProfile.mockResolvedValue(null);
  });

  it('enables the flag when the snapshot carries encryptionMeta', async () => {
    mount();
    capturedOnUpdate?.({
      uid: 'user-1',
      email: 'a@b.c',
      encryptionMeta: { salt: 's', wrappedDataKey: 'w', verification: 'v', version: 1 },
    });

    await waitFor(() => expect(setEncryptionEnabled).toHaveBeenCalledWith('user-1', true));
  });

  it('enables the flag on the legacy salt + wrapped key pair', async () => {
    mount();
    capturedOnUpdate?.({
      uid: 'user-1',
      email: 'a@b.c',
      encryptionSalt: 'legacy-salt',
      encryptedDataKey: 'legacy-wrapped',
    });

    await waitFor(() => expect(setEncryptionEnabled).toHaveBeenCalledWith('user-1', true));
  });

  it('never clears the flag when the snapshot simply lacks the field', async () => {
    mount();
    capturedOnUpdate?.({ uid: 'user-1', email: 'a@b.c', nickname: 'A' });

    // Даём микрозадачам отработать, затем убеждаемся, что снятия не было.
    await waitFor(() => expect(mockGetProfile).not.toHaveBeenCalled());
    expect(setEncryptionEnabled).not.toHaveBeenCalledWith('user-1', false);
  });

  // Раньше флаг снимался в начале этой ветки — до authoritative getProfile,
  // который здесь как раз возвращает профиль с сейфом.
  it('never clears the flag on an empty snapshot before the authoritative read', async () => {
    mockGetProfile.mockResolvedValue({
      uid: 'user-1',
      encryptionMeta: { salt: 's', wrappedDataKey: 'w', verification: 'v', version: 1 },
    });

    mount();
    capturedOnUpdate?.(null);

    await waitFor(() => expect(mockGetProfile).toHaveBeenCalledWith('user-1'));
    expect(setEncryptionEnabled).not.toHaveBeenCalledWith('user-1', false);
  });
});
