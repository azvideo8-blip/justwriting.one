// AUD-14: migrateFromLegacy писал мету сейфа без recovery code — единственной
// вещи между забытым паролем и навсегда нечитаемым архивом. Теперь миграция
// обязана выдать код. Фальсификация: убрать генерацию/запись recovery-полей —
// тест краснеет.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetProfile = vi.fn();
const mockSaveMeta = vi.fn();

vi.mock('../../data', () => ({
  DataProvider: { getProfile: (...a: unknown[]) => mockGetProfile(...a) },
}));

vi.mock('../EncryptionMetaService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../EncryptionMetaService')>();
  return {
    ...actual,
    saveEncryptionMeta: (...a: unknown[]) => mockSaveMeta(...a),
  };
});

vi.mock('../../crypto/encrypt', () => ({
  unwrapDataKeyWithPassword: vi.fn().mockResolvedValue({ dataKey: 'dk' }),
  deriveMasterKey: vi.fn().mockResolvedValue('mk'),
  wrapDataKey: vi.fn().mockResolvedValue('wrapped'),
  encryptContent: vi.fn().mockResolvedValue('verif'),
  toBase64: vi.fn((s: unknown) => String(s)),
  fromBase64: vi.fn((_s: string) => new Uint8Array(16)),
  SALT_LENGTH: 16,
  setSessionKey: vi.fn(),
  getSessionKey: vi.fn(),
  clearSessionKey: vi.fn(),
  isVaultUnlocked: vi.fn(() => false),
  generateDataKey: vi.fn(),
  decryptContent: vi.fn(),
  PBKDF2_ITERATIONS: 300_000,
}));

vi.mock('../../crypto/cryptoHelpers', () => ({
  setEncryptionEnabled: vi.fn(),
}));

vi.mock('../../crypto/recoveryCode', () => ({
  generateRecoveryCode: () => 'CODE1-CODE2-CODE3-CODE4-CODE5-CODE6',
  wrapDataKeyWithRecoveryCode: vi.fn().mockResolvedValue('recoveryWrapped'),
}));

import { migrateFromLegacy } from '../LegacyKeyMigration';

describe('AUD-14 migration issues a recovery code', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProfile.mockResolvedValue({
      encryptionSalt: 'c2FsdA==',
      encryptedDataKey: 'key',
    });
  });

  it('returns the recovery code to show once', async () => {
    const { recoveryCode } = await migrateFromLegacy('u_mig_1', 'old', 'new');
    expect(recoveryCode).toBe('CODE1-CODE2-CODE3-CODE4-CODE5-CODE6');
  });

  it('writes recoveryWrappedDataKey and recoverySalt into the vault meta', async () => {
    await migrateFromLegacy('u_mig_2', 'old', 'new');
    expect(mockSaveMeta).toHaveBeenCalledTimes(1);
    const meta = mockSaveMeta.mock.calls[0]![1] as Record<string, unknown>;
    expect(meta.recoveryWrappedDataKey).toBe('recoveryWrapped');
    expect(meta.recoverySalt).toBeTruthy();
  });

  it('does not write vault metadata at all when recovery wrapping fails', async () => {
    const rc = await import('../../crypto/recoveryCode');
    vi.mocked(rc.wrapDataKeyWithRecoveryCode).mockRejectedValueOnce(new Error('crypto down'));
    await expect(migrateFromLegacy('u_mig_3', 'old', 'new')).rejects.toThrow('crypto down');
    // Мета без recovery-полей не должна попасть в хранилище.
    expect(mockSaveMeta).not.toHaveBeenCalled();
  });
});
