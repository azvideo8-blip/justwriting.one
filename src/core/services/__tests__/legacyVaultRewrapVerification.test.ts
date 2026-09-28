import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  saltToBase64,
  generateSalt,
} from '../EncryptionMetaService';
import { unlockVault, lockVault } from '../EncryptionService';
import {
  generateDataKey,
  deriveMasterKey,
  wrapDataKey,
  keysEquivalent,
  PBKDF2_ITERATIONS,
  LEGACY_PBKDF2_ITERATIONS,
} from '../../crypto/encrypt';
import { DataProvider } from '../../data';
import { setProfileLoaded, setEncryptionEnabled } from '../../crypto/cryptoHelpers';

const USER = 'user_rewrap_without_verification';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 'test@example.com' }),
  getCurrentUserId: () => USER,
  updateUserPassword: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Часть-мок: криптография настоящая, а `keysEquivalent` — шпион, чтобы
 * подсмотреть обязательную проверку нового wrap'а.
 */
vi.mock('../../crypto/encrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../crypto/encrypt')>();
  return { ...actual, keysEquivalent: vi.fn(actual.keysEquivalent) };
});

const keysEquivalentMock = vi.mocked(keysEquivalent);

/**
 * Сейф, у которого нет verification-строки: `getEncryptionMeta` отдаёт '' для
 * отсутствующего поля. Прежний код в этом случае ставил `isVerified = true` —
 * то есть записывал в базу непроверенный wrap. Единственное доступное
 * доказательство здесь — что развёрнутый кандидат и есть ключ сессии.
 */
async function createLegacyVaultWithoutVerification(password: string) {
  const dataKey = await generateDataKey();
  const salt = generateSalt();
  const masterKey = await deriveMasterKey(password, salt, LEGACY_PBKDF2_ITERATIONS);
  const wrappedDataKey = await wrapDataKey(dataKey, masterKey);
  return {
    salt: saltToBase64(salt),
    version: 2,
    wrappedDataKey,
    verification: '',
    iterations: LEGACY_PBKDF2_ITERATIONS,
  };
}

describe('C-1: переворот legacy-сейфа без verification-строки', () => {
  let stored: Record<string, unknown> | null = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, false);
    lockVault(USER);
    stored = null;
    vi.spyOn(DataProvider, 'getEncryptionMeta').mockImplementation(async () =>
      stored ? { encryptionMeta: stored as never } : null);
    vi.spyOn(DataProvider, 'saveEncryptionMeta').mockImplementation(async (_uid, data: unknown) => {
      stored = (data as { encryptionMeta: Record<string, unknown> }).encryptionMeta;
    });
  });

  it('кандидат сравнивается с ключом сессии до записи', async () => {
    const password = 'noVerificationVault';
    stored = await createLegacyVaultWithoutVerification(password) as unknown as Record<string, unknown>;

    await unlockVault(USER, password);

    expect(keysEquivalentMock, 'проверка обязательна и без verification').toHaveBeenCalled();
    expect(stored!.iterations).toBe(PBKDF2_ITERATIONS);
  }, 30_000);

  it('сравнение сказало «не тот ключ» → в базу не пишем, сейф остаётся открытым', async () => {
    const password = 'mismatchedWrap';
    stored = await createLegacyVaultWithoutVerification(password) as unknown as Record<string, unknown>;
    const original = stored;

    keysEquivalentMock.mockResolvedValueOnce(false);
    await unlockVault(USER, password);

    expect(stored, 'непроверенный wrap не должен попасть в базу').toBe(original);
    expect(stored!.iterations).toBe(LEGACY_PBKDF2_ITERATIONS);
  }, 30_000);
});
