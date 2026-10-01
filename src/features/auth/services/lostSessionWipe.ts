import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { hasLocalDatabase } from '../../../core/storage/localDb';
import { reportError } from '../../../shared/errors/reportError';

type ShowToast = (
  message: string,
  type?: 'success' | 'error' | 'info' | 'warning',
  action?: { label: string; onClick: () => void },
) => void;
type Translate = (key: string, params?: Record<string, string | number>) => string;
type Confirm = (opts: { title: string; message?: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>;

/**
 * S-28 (O-5): на устройстве, где сессию оборвало не по воле человека (аккаунт
 * удалили с другого устройства либо отозвали вход), отдельного признака в ответе
 * сервера нет — `verifyJwt` проверяет только подпись. Поэтому предложение стереть
 * данные завязано не на причину, а на факт: локальная база этого uid здесь
 * осталась. Молча стирать нельзя — разрушительное действие под видом «сессия
 * истекла» хуже разлогина.
 *
 * S-33: кнопка в тосте открывает подтверждение, которое называет, что именно
 * уходит (данные этого аккаунта на устройстве и гостевые), и предупреждает о
 * несинхронизированных записях — обрыв сессии бывает и у живого аккаунта
 * («выйти на других устройствах»), и один клик по тосту стирал их без вопроса.
 */
export async function offerLostSessionWipe(showToast: ShowToast, t: Translate, confirm: Confirm): Promise<void> {
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
        try {
          const { countUnsyncedLocalData } = await import('./unsyncedLocalData');
          const unsynced = await countUnsyncedLocalData(lostUid);
          const message = [
            t('auth_lost_session_wipe_confirm_message'),
            unsynced.total > 0 ? t('auth_lost_session_wipe_confirm_unsynced', { count: unsynced.total }) : '',
          ].filter(Boolean).join(' ');
          const ok = await confirm({
            title: t('auth_lost_session_wipe_confirm_title'),
            message,
            confirmLabel: t('auth_lost_session_wipe_button'),
            destructive: true,
          });
          if (!ok) return;
          const { AuthService } = await import('../services/AuthService');
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
