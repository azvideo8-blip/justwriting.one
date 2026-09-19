import { signIn, signUp, signOutUser, sendPasswordResetEmail, getCurrentUser, reauthenticate, type AppUser } from '../../../core/auth';
import { unwrapDataKeyWithPassword, setSessionKey, fromBase64, decryptContent } from '../../../core/crypto/encrypt';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import { resetDbInstance } from '../../../core/storage/localDb';

async function signUpWithEmail(email: string, password: string) {
  resetDbInstance();
  return signUp(email, password);
}

async function signInWithEmail(email: string, password: string): Promise<{ user: AppUser; recoveryCode?: string }> {
  resetDbInstance();
  const user = await signIn(email, password);
  const currentUid = user.uid;
  const { DataProvider } = await import('../../../core/data');
  const profileData = await DataProvider.getProfile(currentUid);

  const hasExistingVault = !!(profileData?.encryptionMeta || (profileData?.encryptionSalt && profileData?.encryptedDataKey));

  if (hasExistingVault) {
    const unlocked = await unlockVaultFromProfile(profileData!, password, currentUid);
    if (!unlocked) {
      const pendingRaw = sessionStorage.getItem(`pending_keys_${currentUid}`);
      if (pendingRaw) {
        try {
          const keys = JSON.parse(pendingRaw);
          await DataProvider.updateProfile(currentUid, keys);
          sessionStorage.removeItem(`pending_keys_${currentUid}`);
          await unlockVaultFromPendingKeys(keys, password, currentUid);
        } catch (repairErr) {
          reportError(repairErr, { action: 'repairEncryptionKeys' });
        }
      }
    }
    return { user };
  } else {
    // Brand new user or user without a vault logging in with an active session:
    // Create vault automatically from the sign-in password and issue recovery code!
    try {
      const { initializeEncryption } = await import('../../../core/services/EncryptionService');
      const { recoveryCode } = await initializeEncryption(currentUid, password);
      return { user, recoveryCode };
    } catch (e) {
      // Вход не роняем. Неудача здесь — это чаще всего сеть, а запертая дверь
      // в собственный дневник хуже, чем сессия без шифрования: второе
      // исправимо, первое человек воспринимает как потерю всего.
      //
      // Попытка повторится сама при следующем входе: сейф так и не создан,
      // значит эта ветка выполнится снова. Порядок внутри initializeEncryption
      // делает повтор безопасным — метаданные пишутся последними, так что
      // прерванная попытка не оставляет сейфа, который нечем открыть.
      reportError(e, { action: 'signInWithEmail_autoInitializeVault', userId: currentUid });
      return { user };
    }
  }
}

/**
 * Signing out clears session credentials and keys in memory/cache.
 *
 * By default (`clearLocalData` is false), local data in IndexedDB is PRESERVED.
 * When `clearLocalData` is true (e.g. user selected "shared computer"), all local stores
 * are cleared, guarded by unsynced data protection unless `force` is true.
 */
async function signOut(opts?: { clearLocalData?: boolean; force?: boolean; isAccountDeletion?: boolean }) {
  const currentUid = getCurrentUser()?.uid;
  let wipeFailed: unknown = null;

  if (opts?.clearLocalData === true) {
    if (!opts?.force) {
      const { countUnsyncedLocalData, UnsyncedLocalDataError } = await import('./unsyncedLocalData');
      const unsynced = await countUnsyncedLocalData(currentUid);
      if (unsynced.total > 0) throw new UnsyncedLocalDataError(unsynced);
    }

    try {
      const { clearAllLocalStores, deleteLocalDatabase } = await import('../../../core/storage/localDb');
      await clearAllLocalStores(currentUid);
      if (opts?.isAccountDeletion && currentUid) {
        await deleteLocalDatabase(currentUid);
      }
    } catch (e) {
      wipeFailed = e;
      reportError(e, { action: 'signOut_clearLocalDb' });
    }

    // Стирается только то, что принадлежит этому аккаунту: в диалоге выхода
    // человеку показали число ЕГО записей, а localStorage.clear() заодно
    // выносил сейф, согласия и черновики другого аккаунта этого браузера.
    // Общие настройки (тема, язык) — не данные человека, они остаются.
    try {
      const { clearAccountScopedStorage } = await import('./accountScopedKeys');
      clearAccountScopedStorage(currentUid);
      sessionStorage.clear();
    } catch {
      /* ignore */
    }

    // AUD-11: обещание «на этом компьютере ничего не останется» не выполнено.
    // Молчать нельзя — но и запирать выход ради этого тоже: сам выход ниже
    // всё равно состоится, а ошибка уйдёт в диалог после него.
  } else {
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  }

  try {
    const { clearDeviceKey } = await import('../../../core/crypto/keyVaultCache');
    await clearDeviceKey(currentUid);
  } catch (e) {
    reportError(e, { action: 'signOut_clearDeviceKey' });
  }

  try {
    const { useEncryptionStore } = await import('../../../core/crypto/useEncryptionStore');
    useEncryptionStore.getState().lockVault();
  } catch (e) {
    reportError(e, { action: 'signOut_lockVault' });
  }

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('auth:signed-out'));
    } catch {
      /* ignore */
    }
  }

  await signOutUser();
  resetDbInstance();

  // AUD-11: выход состоялся; теперь сообщаем, что локальная очистка не прошла.
  if (wipeFailed) {
    const { LocalWipeFailedError } = await import('./unsyncedLocalData');
    throw new LocalWipeFailedError(wipeFailed);
  }
}

async function sendPasswordReset(email: string) {
  return sendPasswordResetEmail(email);
}

async function signOutOthers(): Promise<void> {
  await signOutUser({ scope: 'others' });
}

async function recoverVault(userId: string, recoveryCode: string, newPassword: string): Promise<void> {
  const { recoverVaultWithCode } = await import('../../../core/services/EncryptionService');
  return recoverVaultWithCode(userId, recoveryCode, newPassword);
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
      iterations?: number;
    };
    if (!meta.salt || !meta.wrappedDataKey) {
      return false;
    }
    const salt = fromBase64(meta.salt);
    try {
      // Falls back to the pre-SEC-36 iteration count: vaults wrapped at 300k
      // cannot be opened with a key derived at 600k, and the user just sees
      // "wrong password" for a password that is correct.
      const { dataKey } = await unwrapDataKeyWithPassword(meta.wrappedDataKey, password, salt, undefined, undefined, meta.iterations);
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

// AUD-20: удаление необратимо — живой сессии недостаточно, нужен пароль снова.
async function deleteAccount(password: string): Promise<void> {
  const user = getCurrentUser();
  if (!user) throw new Error('No authenticated user');
  if (!password) throw new Error('Password required to delete the account');
  if (!user.email) throw new Error('Account has no email to re-authenticate');

  await reauthenticate(user.email, password);

  const { callAi } = await import('../../../core/ai/callAi');
  await callAi('deleteAccount', {});
  // Аккаунт удалён на сервере — оставлять его заметки, разборы и портрет на
  // устройстве нельзя. Без явного флага signOut сохраняет локальное, и
  // «удалить аккаунт» уносило только облачную половину. Флаг force обязателен:
  // аккаунт на сервере уже уничтожен, отменять локальную очистку из-за
  // несинхронизированных данных бессмысленно и заблокировало бы выход.
  await signOut({ clearLocalData: true, force: true, isAccountDeletion: true });
}

export const AuthService = {
  signUpWithEmail,
  signInWithEmail,
  signOut,
  signOutOthers,
  sendPasswordReset,
  getCurrentUserId,
  getCurrentUser,
  unlockVaultFromProfile,
  unlockVaultFromPendingKeys,
  recoverVault,
  deleteAccount,
};

