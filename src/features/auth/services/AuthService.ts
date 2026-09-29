import { signIn, signUp, signOutUser, sendPasswordResetEmail, getCurrentUser, reauthenticate, type AppUser } from '../../../core/auth';
import { setPendingLoginPassword, clearPendingLoginPassword } from '../../../core/crypto/pendingLoginPassword';
import { unwrapDataKeyWithPassword, setSessionKey, fromBase64, decryptContent } from '../../../core/crypto/encrypt';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { clearDeviceKey } from '../../../core/crypto/keyVaultCache';
import { reportError } from '../../../shared/errors/reportError';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';
import { resetDbInstance } from '../../../core/storage/localDb';
import { setAccountChangeNotice, setAccountReloadTarget, skipFlushOnAccountReload, takeAccountChangeNotice } from '../../../core/auth/accountReload';

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

  const { STORAGE_KEYS } = await import('../../../shared/constants/storageKeys');

  if (hasExistingVault) {
    const unlocked = await unlockVaultFromProfile(profileData!, password, currentUid);
    if (!unlocked) {
      sessionStorage.setItem(STORAGE_KEYS.VAULT_AUTO_UNLOCK_FAILED(currentUid), '1');
      // D-28: сейф на другом пароле (вход сбросили по почте). Ручная разблокировка
      // прежним паролем перешифрует сейф этим — см. pendingLoginPassword.ts.
      setPendingLoginPassword(currentUid, password);
      const pendingRaw = sessionStorage.getItem(`pending_keys_${currentUid}`);
      if (pendingRaw) {
        try {
          const keys = JSON.parse(pendingRaw);
          await DataProvider.updateProfile(currentUid, keys);
          sessionStorage.removeItem(`pending_keys_${currentUid}`);
          const repairedUnlocked = await unlockVaultFromPendingKeys(keys, password, currentUid);
          if (repairedUnlocked) {
            sessionStorage.removeItem(STORAGE_KEYS.VAULT_AUTO_UNLOCK_FAILED(currentUid));
            clearPendingLoginPassword(currentUid);
          }
        } catch (repairErr) {
          reportError(repairErr, { action: 'repairEncryptionKeys' });
        }
      }
    } else {
      sessionStorage.removeItem(STORAGE_KEYS.VAULT_AUTO_UNLOCK_FAILED(currentUid));
    }
    return { user };
  } else {
    // Brand new user or user without a vault logging in with an active session:
    // Create vault automatically from the sign-in password and issue recovery code!
    try {
      const { initializeEncryption } = await import('../../../core/services/EncryptionService');
      const { recoveryCode } = await initializeEncryption(currentUid, password, undefined, true);
      try {
        const { STORAGE_KEYS } = await import('../../../shared/constants/storageKeys');
        // R3-2: sessionStorage — переживает перезагрузку вкладки, но не её закрытие и
        // не выход. В localStorage код жил бессрочно рядом с паролем.
        sessionStorage.setItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(currentUid), recoveryCode);
        localStorage.setItem(STORAGE_KEYS.VAULT_AUTO_CREATED(currentUid), '1');
        window.dispatchEvent(new CustomEvent('pending_recovery_code_updated'));
      } catch { /* private mode */ }
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
  clearPendingLoginPassword();
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
    } catch (e) {
      wipeFailed = wipeFailed || e;
      reportError(e, { action: 'signOut_clearAccountScopedStorage' });
    }

    // AUD-11: обещание «на этом компьютере ничего не останется» не выполнено.
    // Молчать нельзя — но и запирать выход ради этого тоже: сам выход ниже
    // всё равно состоится, а ошибка уйдёт в диалог после него.
  } else {
    try {
      sessionStorage.clear();
      // R3-2: код восстановления старых версий лежал в localStorage — при выходе убираем.
      const { STORAGE_KEYS } = await import('../../../shared/constants/storageKeys');
      if (currentUid) localStorage.removeItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(currentUid));
    } catch {
      /* ignore */
    }
  }

  try {
    await clearDeviceKey(currentUid);
  } catch (e) {
    if (opts?.clearLocalData) {
      wipeFailed = wipeFailed || e;
    }
    reportError(e, { action: 'signOut_clearDeviceKey' });
  }

  try {
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

  // Выход перезагружает страницу (accountReload.ts) — сообщение и переход на
  // вход задаём заранее, показывать их будет уже новая страница.
  setAccountChangeNotice(
    opts?.isAccountDeletion ? 'account_deleted'
      : wipeFailed ? 'wipe_failed'
        : opts?.clearLocalData ? 'signed_out_wiped' : 'signed_out',
  );
  setAccountReloadTarget('/login');
  if (opts?.clearLocalData === true) skipFlushOnAccountReload();
  try {
    await signOutUser();
  } catch (e) {
    // Выход не состоялся — и «Вы вышли» на следующей странице быть не должно.
    takeAccountChangeNotice();
    setAccountReloadTarget(null);
    skipFlushOnAccountReload(false);
    throw e;
  }
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
      const { dataKey, usedLegacyIterations } = await unwrapDataKeyWithPassword(meta.wrappedDataKey, password, salt, undefined, undefined, meta.iterations);
      if (meta.verification) {
        const isValid = await verifyKey(dataKey, meta.verification);
        if (!isValid) return false;
      }
      setSessionKey(dataKey);
      setEncryptionEnabled(userId, true);
      // B-1 (R2-006): вход по паролю обязан переворачивать 300k-обёртку на
      // 600k, как это делает ручная разблокировка, — иначе обещание
      // SECURITY.md выполняется только для тех, кто разблокирует сейф вручную.
      // Тот же helper, что и в EncryptionService: вторая реализация переворота
      // расходится с первой в проверках и в потере полей меты. Сам helper
      // ошибок не отдаёт — переворот не может уронить вход.
      const { rewrapLegacyVaultIterations } = await import('../../../core/services/EncryptionService');
      await rewrapLegacyVaultIterations(
        userId,
        password,
        dataKey,
        { salt: meta.salt, wrappedDataKey: meta.wrappedDataKey, verification: meta.verification },
        usedLegacyIterations,
      );
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'OperationError') {
        // Ожидаемый сценарий при несовпадении введённого пароля аккаунта с паролем сейфа
        // (например, при смене пароля на другом устройстве). Сейф будет открыт в модальном окне.
        return false;
      }
      throw e;
    }
  }

  // Профиль старой формы (encryption_salt + encrypted_data_key, меты сейфа
  // нет): переворачивать нечего — `iterations` и recovery code живут в мете,
  // а создать мету молча означало бы сейф без кода восстановления (AUD-14).
  // Для этого вида есть интерактивная миграция: EncryptionPasswordModal →
  // `migrateFromLegacy`, которая фиксирует `iterations` и выдаёт код.
  // `unlockVaultFromPendingKeys` ниже — та же старая форма, восстановленная из
  // sessionStorage, поэтому и тот же путь.
  if (profileData.encryptionSalt && profileData.encryptedDataKey) {
    const salt = fromBase64(profileData.encryptionSalt);
    try {
      const { dataKey } = await unwrapDataKeyWithPassword(profileData.encryptedDataKey, password, salt);
      setSessionKey(dataKey);
      setEncryptionEnabled(userId, true);
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'OperationError') {
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

