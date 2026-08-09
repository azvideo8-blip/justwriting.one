import { signIn, signUp, signOutUser, sendPasswordResetEmail, getCurrentUser } from '../../../core/auth';
import { unwrapDataKeyWithPassword, setSessionKey, fromBase64, decryptContent } from '../../../core/crypto/encrypt';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';

async function signUpWithEmail(email: string, password: string) {
  return signUp(email, password);
}

async function signInWithEmail(email: string, password: string) {
  return signIn(email, password);
}

/**
 * Signing out clears every local store — correct on a shared machine, and safe
 * only while the cloud holds a copy of everything. It used to do that
 * unconditionally, so a local-only note, a queued edit or an unfinished draft
 * was destroyed by an ordinary "Выйти", under a UI promising the opposite.
 *
 * The refusal lives here rather than in the two call sites: an invariant that
 * depends on every caller remembering is not an invariant. `force` is the
 * user's explicit "выйти и удалить локальные данные".
 */
async function signOut(opts?: { force?: boolean }) {
  const currentUid = getCurrentUser()?.uid;

  if (!opts?.force) {
    const { countUnsyncedLocalData, UnsyncedLocalDataError } = await import('./unsyncedLocalData');
    const unsynced = await countUnsyncedLocalData(currentUid);
    if (unsynced.total > 0) throw new UnsyncedLocalDataError(unsynced);
  }

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

  return signOutUser();
}


async function sendPasswordReset(email: string) {
  return sendPasswordResetEmail(email);
}



function getCurrentUserId(): string | null {
  return getCurrentUser()?.uid ?? null;
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
    try {
      // Falls back to the pre-SEC-36 iteration count: vaults wrapped at 300k
      // cannot be opened with a key derived at 600k, and the user just sees
      // "wrong password" for a password that is correct.
      const { dataKey } = await unwrapDataKeyWithPassword(meta.wrappedDataKey, password, salt);
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
    try {
      const { dataKey } = await unwrapDataKeyWithPassword(profileData.encryptedDataKey, password, salt);
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
  const { dataKey } = await unwrapDataKeyWithPassword(keys.encryptedDataKey, password, salt);
  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);
  return true;
}

async function deleteAccount(): Promise<void> {
  const user = getCurrentUser();
  if (!user) throw new Error('No authenticated user');

  const { callAi } = await import('../../../core/ai/callAi');
  await callAi('deleteAccount', {});
  await signOut();
}

export const AuthService = {
  signUpWithEmail,
  signInWithEmail,
  signOut,
  sendPasswordReset,
  getCurrentUserId,
  getCurrentUser,
  unlockVaultFromProfile,
  unlockVaultFromPendingKeys,
  deleteAccount,
};

