import { useEffect, useState } from 'react';
import { useAuthStatus } from '../../../features/auth/hooks/useAuthStatus';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

/* Переехал из `SyncConsentModal.tsx` в отдельный модуль (MC-6): хук читает
 * AppProviders, то есть index-кусок, а окно нужен только там, где его реально
 * показывают. На телефоне первый вход делает степпер, и вносить разметку окна
 * в стартовый кусок больше незачем. */

/** suspended: пока открыт мастер приглашения, вопрос задаёт он сам. Проверка
 * перезапускается, когда мастер закрылся, и читает уже записанный им ответ —
 * иначе окно всплывало по решению, принятому до мастера. */
export function useSyncConsentCheck(suspended = false) {
  const { user, isAuthenticated, isGuest, authState } = useAuthStatus();
  const [showConsent, setShowConsent] = useState(false);

  useEffect(() => {
    // Only ask when explicitly authenticated and auth is fully ready
    if (suspended || authState !== 'authenticated' || !isAuthenticated || isGuest || !user) {
      // Defer to avoid synchronous setState in effect body
      const t = setTimeout(() => setShowConsent(false), 0);
      return () => clearTimeout(t);
    }

    let cancelled = false;
    const checkLocalDocs = async () => {
      // LS-2: Adopt legacy unscoped keys for the first signed-in account that reads them
      const scopedEnabled = localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(user.uid));
      const scopedAsked = localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ASKED(user.uid));
      if (scopedEnabled === null && scopedAsked === null) {
        const legacyEnabled = localStorage.getItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ENABLED);
        const legacyAsked = localStorage.getItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ASKED);
        if (legacyEnabled !== null || legacyAsked !== null) {
          if (legacyEnabled !== null) {
            localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(user.uid), legacyEnabled);
            localStorage.removeItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ENABLED);
          }
          if (legacyAsked !== null) {
            localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ASKED(user.uid), legacyAsked);
            localStorage.removeItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ASKED);
          }
        }
      }

      // If auto_sync_enabled key is already set or auto_sync_asked is already set, don't ask
      if (
        localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(user.uid)) !== null ||
        localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ASKED(user.uid)) !== null
      ) {
        if (!cancelled) setShowConsent(false);
        return;
      }

      // D-22: Показывать каждому аккаунту при первом входе, даже если заметок ещё нет.
      if (!cancelled) {
        setShowConsent(true);
      }
    };

    // R7Q-015: в Safari с «блокировать все файлы cookie» любое обращение к
    // localStorage бросает SecurityError. Без этой рамки async-функция
    // отвергалась необработанно, showConsent так и не становился true, и на новом
    // устройстве вопрос про облачную синхронизацию не задавался ни сейчас, ни
    // позже. Отказ хранилища значит «ключа нет», а он ведёт к показу.
    void checkLocalDocs().catch(() => setShowConsent(true));
    return () => { cancelled = true; };
  }, [user, isAuthenticated, isGuest, authState, suspended]);

  return { showConsent, setShowConsent };
}
