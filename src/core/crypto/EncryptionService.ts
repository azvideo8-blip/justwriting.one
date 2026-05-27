import { deriveMasterKey, wrapDataKey, unwrapDataKey, setSessionKey, getSessionKey, toBase64, fromBase64, SALT_LENGTH, generateDataKey, clearSessionKey } from './encrypt';
import { setEncryptionEnabled } from './cryptoHelpers';
import { encryptAllExistingNotes, type MigrationProgress } from './encryptMigration';
import { getClient } from '../firebase/firestoreClient';
import { AuthService } from '../../features/auth/services/AuthService';

async function unlockVault(userId: string, password: string, profile: { encryptionSalt: string; encryptedDataKey: string }) {
  const salt = fromBase64(profile.encryptionSalt);
  const masterKey = await deriveMasterKey(password, salt);
  const dataKey = await unwrapDataKey(profile.encryptedDataKey, masterKey);
  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);
}

async function initializeEncryption(userId: string, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const masterKey = await deriveMasterKey(password, salt);
  const dataKey = await generateDataKey();
  const wrappedDataKey = await wrapDataKey(dataKey, masterKey);

  const { db, mod } = await getClient();
  const { doc, setDoc } = mod;
  await setDoc(doc(db, 'users', userId), {
    encryptionSalt: toBase64(salt),
    encryptedDataKey: wrappedDataKey,
  }, { merge: true });

  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);
}

function lockVault(userId: string) {
  clearSessionKey();
  setEncryptionEnabled(userId, false);
}

async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = AuthService.getCurrentUser();
  if (!user || !user.email) throw new Error('Not authenticated');

  await AuthService.reauthenticate(currentPassword);

  const { db, mod } = await getClient();
  const { doc, getDoc, setDoc } = mod;
  const profileSnap = await getDoc(doc(db, 'users', user.uid));
  if (!profileSnap.exists() || !profileSnap.data().encryptionSalt || !profileSnap.data().encryptedDataKey) {
    throw new Error('Encryption keys not found');
  }

  const profileData = profileSnap.data();
  const oldSalt = fromBase64(profileData.encryptionSalt as string);
  const oldMasterKey = await deriveMasterKey(currentPassword, oldSalt);
  const dataKey = await unwrapDataKey(profileData.encryptedDataKey as string, oldMasterKey);

  const newSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const newMasterKey = await deriveMasterKey(newPassword, newSalt);
  const newWrappedDataKey = await wrapDataKey(dataKey, newMasterKey);

  const oldProfile = {
    encryptionSalt: profileData.encryptionSalt as string,
    encryptedDataKey: profileData.encryptedDataKey as string,
  };

  await setDoc(doc(db, 'users', user.uid), {
    encryptionSalt: toBase64(newSalt),
    encryptedDataKey: newWrappedDataKey,
  }, { merge: true });

  try {
    await AuthService.updatePasswordDirect(newPassword);
  } catch (pwErr) {
    await setDoc(doc(db, 'users', user.uid), oldProfile, { merge: true });
    throw pwErr;
  }

  setSessionKey(dataKey);
}

async function encryptAll(userId: string, onProgress: (p: MigrationProgress) => void, signal: AbortSignal) {
  if (!getSessionKey()) throw new Error('Vault is locked');
  return encryptAllExistingNotes(userId, onProgress, signal);
}

export const EncryptionService = {
  unlockVault,
  initializeEncryption,
  lockVault,
  changePassword,
  encryptAll,
};
