import { Cloud, EyeOff, HardDrive, Sparkles } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';

/** MF-14 + U-21 (решение владельца 2026-10-18): где лежит заметка, ждёт ли
 *  отправки, скрыта ли от ИИ и разобрана ли она. Десктоп — эталон, поэтому на
 *  телефоне те же смыслы, тот же порядок и те же состояния, что у кнопок
 *  `StorageButtons` (14-15, 83, 103, 121): HardDrive · Cloud · EyeOff · Sparkles,
 *  включённое состояние — `brand-soft` со свечением, «не отправлено» —
 *  `accent-warning`, «скрыто от ИИ» — `accent-danger`, нет сигнала — приглушён.
 *  Тональные строки повторяют десктопные буквально: править `StorageButtons`
 *  нельзя, а расхождение здесь означает, что телефон врёт о состоянии заметки.
 *  Здесь это индикаторы, а не кнопки (MR-9): никаких onClick и целей касания —
 *  действия остаются в листе, касание идёт ряду. */
const LIT = 'text-brand-soft [filter:drop-shadow(0_0_4px_color-mix(in_srgb,var(--brand-soft)_60%,transparent))]';
const DIM = 'text-text-main/30';
const PENDING = 'text-accent-warning [filter:drop-shadow(0_0_6px_var(--accent-warning))]';
const HIDDEN = 'text-accent-danger';
/** Разбор приглушён так же, как на десктопе: скрытую от ИИ заметку ИИ не видел. */
const ANALYSIS_MUTED = 'text-text-main/15';

interface StorageStateIconsProps {
  cloud: boolean;
  device: boolean;
  analyzed: boolean;
  /** Есть неотправленные изменения — на десктопе облачный значок горит жёлтым. */
  pendingSync?: boolean | undefined;
  /** Заметка скрыта от ИИ — на десктопе значок глаза красный. */
  excluded?: boolean | undefined;
}

export function StorageStateIcons({ cloud, device, analyzed, pendingSync = false, excluded = false }: StorageStateIconsProps) {
  const { t } = useLanguage();
  const label = [
    device && t('archive_state_device'),
    pendingSync ? t('archive_status_pending_sync') : cloud && t('archive_state_cloud'),
    excluded && t('ai_note_excluded'),
    analyzed && !excluded && t('archive_state_analyzed'),
  ].filter(Boolean).join(' · ');
  const tone = (cls: string) => cn('shrink-0', cls);
  return (
    <span role="img" aria-label={label} data-storage-state className="inline-flex shrink-0 items-center gap-1">
      <HardDrive size={14} aria-hidden="true" data-on={device} className={tone(device ? LIT : DIM)} />
      <Cloud size={14} aria-hidden="true" data-on={cloud || pendingSync} className={tone(pendingSync ? PENDING : cloud ? LIT : DIM)} />
      <EyeOff size={14} aria-hidden="true" data-on={excluded} className={tone(excluded ? HIDDEN : DIM)} />
      <Sparkles size={14} aria-hidden="true" data-on={analyzed && !excluded} className={tone(excluded ? ANALYSIS_MUTED : analyzed ? LIT : DIM)} />
    </span>
  );
}
