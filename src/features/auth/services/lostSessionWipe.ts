import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { hasLocalDatabase } from '../../../core/storage/localDb';
import { reportError } from '../../../shared/errors/reportError';
import { CLOCK_SKEW_THRESHOLD_SEC } from '../../../core/auth/supabaseAuthProvider';

type ShowToast = (
  message: string,
  type?: 'success' | 'error' | 'info' | 'warning',
  action?: { label: string; onClick: () => void },
) => void;
type Translate = (key: string, params?: Record<string, string | number>) => string;
type Confirm = (opts: { title: string; message?: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>;

/**
 * Расхождение с часами сервера по заголовку `Date` ответа на `/health` (важен только
 * заголовок: на проде запрос отвечает статикой nginx, а проксирование `/health` не настроено). Замер по
 * токену здесь не помогает: часы ушли, пока приложение было закрыто, — сохранённый
 * замер либо старый, либо нулевой, а свежего токена уже не будет.
 * null — «не знаю» (нет сети, нет заголовка).
 */
async function serverClockSkewSec(): Promise<number | null> {
  try {
    const res = await fetch('/health', { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
    // Дейлик 05.11: чужой ответ (портал входа в сеть, прокси) — не наш сервер, его часам не верим.
    if (!res.ok) return null;
    const serverMs = Date.parse(res.headers.get('date') ?? '');
    return Number.isFinite(serverMs) ? Math.round((Date.now() - serverMs) / 1000) : null;
  } catch {
    return null;
  }
}

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
  // Дейлик 04.11 Н-1: обещание 0.11.4 — при неверных часах стереть не предлагаем.
  const skewSec = await serverClockSkewSec();
  if (skewSec !== null && Math.abs(skewSec) >= CLOCK_SKEW_THRESHOLD_SEC) {
    const { showClockSkewToast } = await import('./clockSkewToast');
    showClockSkewToast(showToast, t, skewSec, true);
    return;
  }

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
            // Журнал ИИ не читается: предупреждаем и даём стереть — предложение одноразовое.
            unsynced.ai === null ? t('signout_unsynced_unknown_desc') : '',
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
