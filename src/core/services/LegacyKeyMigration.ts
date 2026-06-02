import { deriveMasterKey, unwrapDataKey, wrapDataKey, encryptContent, toBase64, fromBase64, SALT_LENGTH, setSessionKey } from '../crypto/encrypt';
import { setEncryptionEnabled } from '../crypto/cryptoHelpers';
import {
  saveEncryptionMeta,
  getEncryptionMeta,
  ENCRYPTION_META_VERSION,
  VERIFICATION_PLAINTEXT,
} from './EncryptionMetaService';
import { getClient } from '../firebase/firestoreClient';

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
  const { db, mod } = await getClient();
  const { doc, getDoc } = mod;
  const profileSnap = await getDoc(doc(db, 'users', userId));
  if (!profileSnap.exists()) throw new Error('User profile not found');

  const profileData = profileSnap.data();
  if (!profileData.encryptionSalt || !profileData.encryptedDataKey) {
    throw new Error('No legacy encryption data found');
  }

  const encryptionSalt = String(profileData.encryptionSalt);
  const encryptedDataKey = String(profileData.encryptedDataKey);
  const oldSalt = fromBase64(encryptionSalt);
  const oldMasterKey = await deriveMasterKey(firebasePassword, oldSalt);

  let dataKey: CryptoKey;
  try {
    dataKey = await unwrapDataKey(encryptedDataKey, oldMasterKey);
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

  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);
}
