import { Cloud, HardDrive } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { StorageDoc } from './useNoteStorageActions';

/** DC-A3: справа от строки заметки — только статус копий, не кнопки. Действия
 *  (загрузить, скачать, удалить одну из копий, спрятать от ИИ) живут в меню «⋯»,
 *  поэтому здесь нет ни обработчиков, ни подтверждений, ни подсказок «копии нет».
 *  Иконки инертны (DC-X2): `role="img"` с именем, а не кнопка, которую нельзя нажать. */
export function StorageStatus({
  doc,
  downloading,
}: {
  doc: StorageDoc;
  downloading: boolean;
}) {
  const { t } = useLanguage();
  const isUnsynced = !!doc.hasPendingSync && doc.isTooLargeForSync !== true;
  const cloudLabel = isUnsynced ? t('archive_status_pending_sync') : t('archive_status_cloud');

  return (
    <div className="flex items-center gap-1 shrink-0">
      {doc.hasLocal && (
        <span
          role="img"
          aria-label={t('archive_status_local')}
          title={t('archive_status_local')}
          className={cn(
            'w-6 h-6 flex items-center justify-center text-text-main/40',
            downloading && 'animate-pulse text-brand-primary',
          )}
        >
          <HardDrive size={14} aria-hidden="true" />
        </span>
      )}
      {(doc.hasCloud || isUnsynced) && (
        <span
          role="img"
          aria-label={cloudLabel}
          title={cloudLabel}
          className={cn(
            'w-6 h-6 flex items-center justify-center',
            isUnsynced ? 'text-accent-warning/70' : 'text-text-main/40',
          )}
        >
          <Cloud size={14} aria-hidden="true" />
        </span>
      )}
    </div>
  );
}
