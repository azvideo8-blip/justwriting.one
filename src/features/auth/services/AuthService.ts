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
import { deriveMasterKey, unwrapDataKey, setSessionKey, fromBase64, decryptContent } from '../../../core/crypto/encrypt';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';

async function signUpWithEmail(email: string, password: string) {
  return createUserWithEmailAndPassword(auth, email, password);
}

async function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

async function signOut() {
  const currentUid = auth.currentUser?.uid;
  try {
    const { clearAllLocalStores } = await import('../../../core/storage/localDb');
    await clearAllLocalStores();
  } catch (e) {
    reportError(e, { action: 'signOut_clearLocalDb' });
  }

  try {
    const { clearDeviceKey } = await import('../../../core/crypto/keyVaultCache');
    await clearDeviceKey(currentUid);
  } catch (e) {
    reportError(e, { action: 'signOut_clearDeviceKey' });
  }

  try {
    const { useEncryptionStore } = await import('../../../core/crypto/useEncryptionStore');
    useEncryptionStore.getState().setKey(null);
  } catch (e) {
    reportError(e, { action: 'signOut_clearSessionKey' });
  }

  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* ignore */
  }

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

async function verifyKey(dataKey: CryptoKey, verification: string): Promise<boolean> {
  try {
    const result = await decryptContent(verification, dataKey);
    return result === 'justwriting-verify-v1';
  } catch {
    return false;
  }
}

async function unlockVaultFromProfile(profileData: VaultProfileData, password: string, userId: string): Promise<boolean> {
  if (profileData.encryptionMeta) {
    const meta = profileData.encryptionMeta as {
      salt: string;
      wrappedDataKey: string;
      verification?: string;
    };
    if (!meta.salt || !meta.wrappedDataKey) {
      return false;
    }
    const salt = fromBase64(meta.salt);
    const masterKey = await deriveMasterKey(password, salt);
    try {
      const dataKey = await unwrapDataKey(meta.wrappedDataKey, masterKey);
      if (meta.verification) {
        const isValid = await verifyKey(dataKey, meta.verification);
        if (!isValid) return false;
      }
      setSessionKey(dataKey);
      setEncryptionEnabled(userId, true);
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'OperationError') {
        reportError(e, { action: 'unwrapDataKeyFromMeta', userId });
        return false;
      }
      throw e;
    }
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

async function deleteAccount(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('No authenticated user');

  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const { app } = await import('../../../core/firebase/client');
  const functions = getFunctions(app, 'europe-west1');
  const deleteAccountFn = httpsCallable(functions, 'deleteAccount');

  await deleteAccountFn();
  await signOut();
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
  deleteAccount,
};

