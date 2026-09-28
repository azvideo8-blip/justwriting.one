import { deriveMasterKey, unwrapDataKeyWithPassword, wrapDataKey, encryptContent, toBase64, fromBase64, SALT_LENGTH, setSessionKey, PBKDF2_ITERATIONS } from '../crypto/encrypt';
import { generateRecoveryCode, wrapDataKeyWithRecoveryCode } from '../crypto/recoveryCode';
import { setEncryptionEnabled } from '../crypto/cryptoHelpers';
import {
  saveEncryptionMeta,
  generateSalt,
  saltToBase64,
  ENCRYPTION_META_VERSION,
  VERIFICATION_PLAINTEXT,
} from './EncryptionMetaService';
import { DataProvider } from '../data';

export function hasLegacyEncryption(profile: { encryptionSalt?: string | undefined; encryptedDataKey?: string | undefined } | null): boolean {
  return !!(profile?.encryptionSalt && profile?.encryptedDataKey);
}

export function hasVault(profile?: { encryptionMeta?: unknown; encryptionSalt?: string | undefined; encryptedDataKey?: string | undefined } | null): boolean {
  return !!profile?.encryptionMeta || hasLegacyEncryption(profile ?? null);
}

export async function migrateFromLegacy(
  userId: string,
  firebasePassword: string,
  newEncryptionPassword: string,
): Promise<{ recoveryCode: string }> {
  const profileData = await DataProvider.getProfile(userId);
  if (!profileData) throw new Error('User profile not found');
  if (!profileData.encryptionSalt || !profileData.encryptedDataKey) {
    throw new Error('No legacy encryption data found');
  }

  const encryptionSalt = String(profileData.encryptionSalt);
  const encryptedDataKey = String(profileData.encryptedDataKey);
  const oldSalt = fromBase64(encryptionSalt);

  let dataKey: CryptoKey;
  try {
    // Legacy vaults predate the SEC-36 iteration raise by definition — this
    // path would otherwise reject every correct password it was built for.
    ({ dataKey } = await unwrapDataKeyWithPassword(encryptedDataKey, firebasePassword, oldSalt));
  } catch {
    throw new Error('LEGACY_MIGRATION_WRONG_PASSWORD');
  }

  const newSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const newMasterKey = await deriveMasterKey(newEncryptionPassword, newSalt);
  const newWrappedDataKey = await wrapDataKey(dataKey, newMasterKey);
  const verification = await encryptContent(VERIFICATION_PLAINTEXT, dataKey);

  // AUD-14: сейф без recovery code — это забытый пароль навсегда. Миграция
  // обязана выдать код восстановления, как это делает initializeEncryption,
  // либо не писать мету вовсе. Молча создать сейф, который некому восстановить,
  // — единственный исход, которого здесь быть не должно.
  const recoveryCode = generateRecoveryCode();
  const recoverySalt = generateSalt();
  const recoveryWrappedDataKey = await wrapDataKeyWithRecoveryCode(dataKey, recoveryCode, recoverySalt);

  await saveEncryptionMeta(userId, {
    salt: toBase64(newSalt),
    version: ENCRYPTION_META_VERSION,
    // AUDIT-part2 слой 8: миграция создаёт НОВЫЙ сейф — обязан фиксировать
    // iterations, как initializeEncryption и смена пароля. Иначе «все новые
    // сейфы пишут iterations» неправда: поднятая константа дала бы
    // мигрированным сейфам другое поведение, чем созданным заново.
    iterations: PBKDF2_ITERATIONS,
    wrappedDataKey: newWrappedDataKey,
    verification,
    recoveryWrappedDataKey,
    recoverySalt: saltToBase64(recoverySalt),
  });

  // Clean up legacy encryption fields is already handled inside saveEncryptionMeta

  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);

  return { recoveryCode };
}
