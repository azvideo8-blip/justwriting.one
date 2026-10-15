import { Cloud, Smartphone, Sparkles } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';

/** MF-14: где лежит заметка и разобрана ли она — три значка 14 px. Это
 *  индикаторы, а не кнопки: действия остаются в «⋯», касание идёт ряду. */
export function StorageStateIcons({ cloud, device, analyzed }: { cloud: boolean; device: boolean; analyzed: boolean }) {
  const { t } = useLanguage();
  const label = [
    cloud && t('archive_state_cloud'),
    device && t('archive_state_device'),
    analyzed && t('archive_state_analyzed'),
  ].filter(Boolean).join(' · ');
  const tone = (on: boolean) => cn('shrink-0', on ? 'text-text-main/70' : 'text-text-main/20');
  return (
    <span role="img" aria-label={label} data-storage-state className="inline-flex shrink-0 items-center gap-1">
      <Cloud size={14} aria-hidden="true" data-on={cloud} className={tone(cloud)} />
      <Smartphone size={14} aria-hidden="true" data-on={device} className={tone(device)} />
      <Sparkles size={14} aria-hidden="true" data-on={analyzed} className={tone(analyzed)} />
    </span>
  );
}
