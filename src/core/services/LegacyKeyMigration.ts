import { deriveMasterKey, unwrapDataKeyWithPassword, wrapDataKey, encryptContent, toBase64, fromBase64, SALT_LENGTH, setSessionKey } from '../crypto/encrypt';
import { setEncryptionEnabled } from '../crypto/cryptoHelpers';
import {
  saveEncryptionMeta,
  getEncryptionMeta,
  ENCRYPTION_META_VERSION,
  VERIFICATION_PLAINTEXT,
} from './EncryptionMetaService';
import { DataProvider } from '../data';

export function hasLegacyEncryption(profile: { encryptionSalt?: string | undefined; encryptedDataKey?: string | undefined } | null): boolean {
  return !!(profile?.encryptionSalt && profile?.encryptedDataKey);
}

export async function hasNewEncryption(uid: string): Promise<boolean> {
  const meta = await getEncryptionMeta(uid);
  return meta !== null;
}

export async function migrateFromLegacy(
  userId: string,
  firebasePassword: string,
  newEncryptionPassword: string,
): Promise<void> {
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

  await saveEncryptionMeta(userId, {
    salt: toBase64(newSalt),
    version: ENCRYPTION_META_VERSION,
    wrappedDataKey: newWrappedDataKey,
    verification,
  });

  // Clean up legacy encryption fields is already handled inside saveEncryptionMeta

  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);
}
