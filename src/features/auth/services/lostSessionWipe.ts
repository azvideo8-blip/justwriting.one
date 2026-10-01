import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { hasLocalDatabase } from '../../../core/storage/localDb';
import { reportError } from '../../../shared/errors/reportError';

type ShowToast = (
  message: string,
  type?: 'success' | 'error' | 'info' | 'warning',
  action?: { label: string; onClick: () => void },
) => void;

/**
 * S-28 (O-5): на устройстве, где сессию оборвало не по воле человека (аккаунт
 * удалили с другого устройства либо отозвали вход), отдельного признака в ответе
 * сервера нет — `verifyJwt` проверяет только подпись. Поэтому предложение стереть
 * данные завязано не на причину, а на факт: локальная база этого uid здесь
 * осталась. Молча стирать нельзя — разрушительное действие под видом «сессия
 * истекла» хуже разлогина.
 */
export async function offerLostSessionWipe(showToast: ShowToast, t: (key: string) => string): Promise<void> {
  let uid: string | null = null;
  try {
    uid = localStorage.getItem(STORAGE_KEYS.LOST_SESSION_UID);
    if (uid) localStorage.removeItem(STORAGE_KEYS.LOST_SESSION_UID);
  } catch {
    return;
  }
  if (!uid) return;

  const lostUid = uid;
  if (!(await hasLocalDatabase(lostUid))) return;

  showToast(t('auth_lost_session_wipe_hint'), 'warning', {
    label: t('auth_lost_session_wipe_button'),
    onClick: () => {
      void (async () => {
        const { AuthService } = await import('../services/AuthService');
        try {
          await AuthService.wipeDeviceDataForUid(lostUid);
          showToast(t('auth_lost_session_wipe_done'), 'success');
        } catch (e) {
          reportError(e, { action: 'lost_session_wipe' });
          showToast(t('auth_lost_session_wipe_failed'), 'error');
        }
      })();
    },
  });
}
