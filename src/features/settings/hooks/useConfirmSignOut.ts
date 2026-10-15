import { AuthService } from '../../../app/AuthService';
import { emitDomainEvent } from '../../../core/events/domainEvents';
import { useToast } from '../../../shared/components/Toast';
import { useLanguage } from '../../../shared/i18n';

/** Выход из окна SignOutConfirmModal: один путь для /settings и профиля (MF-9). */
export function useConfirmSignOut() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  return async (opts: { clearLocalData: boolean; force?: boolean }) => {
    try {
      // «Вы вышли» (и AUD-11 «очистить не удалось») показывает уже
      // перезагруженная страница — выход перезагружает её (accountReload.ts).
      await AuthService.signOut(opts);
      emitDomainEvent({ type: 'account.reset' });
    } catch (e) {
      const isUnsynced = (e as { name?: string }).name === 'UnsyncedLocalDataError';
      const isWipeFailed = (e as { name?: string }).name === 'LocalWipeFailedError';
      if (!isUnsynced && !isWipeFailed) {
        showToast(t('error_signout_failed'), 'error');
      }
      throw e;
    }
  };
}
