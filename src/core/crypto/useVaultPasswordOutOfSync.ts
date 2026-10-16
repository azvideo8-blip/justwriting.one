import { STORAGE_KEYS } from '../../shared/constants/storageKeys';
import { useEncryptionStore } from './useEncryptionStore';

/**
 * R7F-006: после сброса пароля по e-mail запомненное устройство открывает сейф
 * ключом из кэша, а сам сейф остаётся на прежнем пароле — и молчит об этом до
 * потери устройства. Флаг ставит вход (`AuthService.signInWithEmail`), снимает
 * ручная разблокировка прежним паролем, поэтому «флаг стоит + сейф открыт» — это
 * ровно «открыт ключом устройства».
 */
export function useVaultPasswordOutOfSync(uid: string | null): boolean {
  const isVaultUnlocked = useEncryptionStore(s => s.isVaultUnlocked);
  if (!uid || !isVaultUnlocked) return false;
  try {
    return sessionStorage.getItem(STORAGE_KEYS.VAULT_AUTO_UNLOCK_FAILED(uid)) === '1';
  } catch {
    return false;   // приватный режим: нет флага — нет и плашки
  }
}
