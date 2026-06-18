import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  updatePassword as firebaseUpdatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';
import { deriveMasterKey, unwrapDataKey, setSessionKey, fromBase64 } from '../../../core/crypto/encrypt';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';

async function signUpWithEmail(email: string, password: string) {
  return createUserWithEmailAndPassword(auth, email, password);
}

async function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

async function signOut() {
  return firebaseSignOut(auth);
}

async function sendPasswordReset(email: string) {
  return sendPasswordResetEmail(auth, email);
}

async function reauthenticate(currentPassword: string) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error('No authenticated user');

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  return reauthenticateWithCredential(user, credential);
}

async function updatePasswordDirect(newPassword: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('No authenticated user');
  return firebaseUpdatePassword(user, newPassword);
}

function getCurrentUserId(): string | null {
  return auth.currentUser?.uid ?? null;
}

function getCurrentUser() {
  return auth.currentUser;
}

interface VaultProfileData {
  encryptionMeta?: unknown;
  encryptionSalt?: string;
  encryptedDataKey?: string;
}

async function unlockVaultFromProfile(profileData: VaultProfileData, password: string, userId: string): Promise<boolean> {
  if (profileData.encryptionMeta) {
    setEncryptionEnabled(userId, true);
    return true;
  }

  if (profileData.encryptionSalt && profileData.encryptedDataKey) {
    const salt = fromBase64(profileData.encryptionSalt);
    const masterKey = await deriveMasterKey(password, salt);
    try {
      const dataKey = await unwrapDataKey(profileData.encryptedDataKey, masterKey);
      setSessionKey(dataKey);
      setEncryptionEnabled(userId, true);
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'OperationError') {
        reportError(e, { action: 'legacyUnwrapDataKey', userId });
        return false;
      }
      throw e;
    }
  }

  return false;
}

async function unlockVaultFromPendingKeys(keys: { encryptionSalt: string; encryptedDataKey: string }, password: string, userId: string): Promise<boolean> {
  const salt = fromBase64(keys.encryptionSalt);
  const masterKey = await deriveMasterKey(password, salt);
  const dataKey = await unwrapDataKey(keys.encryptedDataKey, masterKey);
  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);
  return true;
}

export const AuthService = {
  signUpWithEmail,
  signInWithEmail,
  signOut,
  sendPasswordReset,
  reauthenticate,
  updatePasswordDirect,
  getCurrentUserId,
  getCurrentUser,
  unlockVaultFromProfile,
  unlockVaultFromPendingKeys,
};
