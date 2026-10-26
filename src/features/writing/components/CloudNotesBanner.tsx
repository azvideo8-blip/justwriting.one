import { useLanguage } from '../../../shared/i18n';
import { useEmptyDeviceDetection } from '../../../core/sync/useEmptyDeviceDetection';
import { OPEN_RESTORE_CLOUD_EVENT } from '../../../core/sync/restoreCloudEvent';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { CloudDownload } from 'lucide-react';

interface CloudNotesBannerProps {
  className?: string;
}

/**
 * RA1-5: на новом устройстве главный оставался пустым, хотя в облаке лежали
 * заметки. Баннер не пропадает после «Не сейчас» — только после первой
 * локальной записи. Текста заметок в нём нет.
 */
export function CloudNotesBanner({ className }: CloudNotesBannerProps) {
  const { t } = useLanguage();
  const { showCloudBanner, cloudCount } = useEmptyDeviceDetection({ cloudOnlyWhenEmpty: true });
  const content = useContentStore(s => s.content);
  const status = useTimerStore(s => s.status);

  if (!showCloudBanner || status !== 'idle' || content.trim() !== '') return null;

  return (
    <div
      data-testid="cloud-notes-banner"
      className={className ?? 'flex items-center justify-between gap-2 rounded-xl border border-[var(--border-light)] bg-[var(--surface-card)] px-3 py-1 text-[13px] leading-snug text-text-main/70'}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <CloudDownload size={14} className="shrink-0" aria-hidden="true" />
        <span className="truncate">{t('restore_cloud_banner', { count: cloudCount })}</span>
      </span>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(OPEN_RESTORE_CLOUD_EVENT))}
        className="press min-h-11 shrink-0 rounded-lg px-2 font-medium text-text-main"
      >
        {t('restore_cloud_banner_action')}
      </button>
    </div>
  );
}
