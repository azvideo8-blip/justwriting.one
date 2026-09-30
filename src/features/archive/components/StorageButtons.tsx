import type { ReactNode } from 'react';
import { Cloud, EyeOff, HardDrive, Loader2, Sparkles } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { IconButton } from '../../../shared/components/IconButton';
import type { AIExclusion, NoteStorageActions, StorageDoc } from './useNoteStorageActions';
import type { NoteAIState } from './noteActions';

// Состояние заметки с первого взгляда (вернули по просьбе владельца после DC-A3):
// есть копия на устройстве, есть в облаке, разобрана ИИ — иконка горит фирменным
// фиолетовым; ждёт отправки — жёлтым со свечением; нет — приглушена. Иконки —
// кнопки: «нажал — ушло в облако», скачать, удалить копию, разобрать. Та же
// семантика, что у пунктов меню «⋯»: обе стороны берут её из useNoteStorageActions.
const LIT = 'text-brand-soft [filter:drop-shadow(0_0_4px_color-mix(in_srgb,var(--brand-soft)_60%,transparent))]';
const DIM = 'text-text-main/30';

function Slot({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span role="img" aria-label={label} title={label} className="w-6 h-6 flex items-center justify-center">
      {children}
    </span>
  );
}

export function StorageButtons({
  doc,
  userId,
  storage,
  ai,
  exclusion,
}: {
  doc: StorageDoc;
  userId: string;
  storage: Pick<NoteStorageActions, 'uploading' | 'downloading' | 'requestLocal' | 'requestCloud' | 'requestExclusion'>;
  ai?: NoteAIState | undefined;
  exclusion?: AIExclusion | undefined;
}) {
  const { t } = useLanguage();
  const isGuest = !userId || userId.startsWith('guest_');
  const isTooLarge = doc.isTooLargeForSync === true;
  const isUnsynced = !!doc.hasPendingSync && !isTooLarge;
  const canUpload = !doc.hasCloud && !isTooLarge && !!doc.localId && !isGuest;
  const canDownload = !doc.hasLocal && doc.hasCloud && !!doc.cloudId;
  const both = (status: string, action: string) => `${status} · ${action}`;

  const localLabel = storage.downloading
    ? t('common_loading')
    : doc.hasLocal
      ? both(t('archive_status_local'), t('storage_remove_local'))
      : canDownload
        ? both(t('archive_status_no_local'), t('storage_download_to_local'))
        : t('archive_status_no_local');

  const cloudLabel = storage.uploading
    ? t('common_loading')
    : isTooLarge
      ? t('storage_too_large_cloud')
      : isUnsynced
        ? both(t('archive_status_pending_sync'), t('storage_sync_now'))
        : doc.hasCloud
          ? both(t('archive_status_cloud'), t('storage_remove_cloud'))
          : canUpload
            ? both(t('archive_status_no_cloud'), t('storage_upload_to_cloud'))
            : t('archive_status_no_cloud');

  const localLive = doc.hasLocal || canDownload;
  const cloudLive = isUnsynced || doc.hasCloud || canUpload;
  const excluded = exclusion?.excluded === true;
  const exclusionLabel = exclusion?.loading ? t('common_loading') : excluded ? both(t('ai_note_excluded'), t('ai_note_include')) : t('ai_note_exclude');
  const aiLabel = ai?.loading ? t('common_loading') : ai?.processed ? both(t('archive_status_ai_done'), t('ai_note_clear')) : both(t('archive_status_ai_none'), t('ai_note_analyze'));

  return (
    <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
      {localLive ? (
        <IconButton
          size="sm"
          label={localLabel}
          title={localLabel}
          disabled={storage.downloading}
          onClick={e => { e.stopPropagation(); storage.requestLocal(); }}
          className={cn(
            'w-6 h-6 rounded-lg transition-colors',
            storage.downloading ? 'animate-pulse text-brand-soft' : doc.hasLocal ? cn(LIT, 'hover:text-accent-danger') : cn(DIM, 'hover:text-brand-soft'),
          )}
          icon={storage.downloading ? <Loader2 size={14} className="animate-spin" /> : <HardDrive size={14} aria-hidden="true" />}
        />
      ) : (
        <Slot label={localLabel}><HardDrive size={14} className={DIM} aria-hidden="true" /></Slot>
      )}

      {cloudLive ? (
        <IconButton
          size="sm"
          label={cloudLabel}
          title={cloudLabel}
          disabled={storage.uploading}
          onClick={e => { e.stopPropagation(); storage.requestCloud(); }}
          className={cn(
            'w-6 h-6 rounded-lg transition-colors',
            storage.uploading
              ? 'animate-pulse text-brand-soft'
              : isUnsynced
                ? 'text-accent-warning [filter:drop-shadow(0_0_6px_var(--accent-warning))]'
                : doc.hasCloud ? cn(LIT, 'hover:text-accent-danger') : cn(DIM, 'hover:text-brand-soft'),
          )}
          icon={storage.uploading ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} aria-hidden="true" />}
        />
      ) : (
        <Slot label={cloudLabel}>
          <Cloud size={14} className={isTooLarge ? 'text-accent-warning/60' : DIM} aria-hidden="true" />
        </Slot>
      )}

      {exclusion && (
        <IconButton
          size="sm"
          label={exclusionLabel}
          title={exclusionLabel}
          disabled={exclusion.loading}
          onClick={e => { e.stopPropagation(); storage.requestExclusion(); }}
          className={cn('w-6 h-6 rounded-lg transition-colors', excluded ? 'text-accent-danger' : cn(DIM, 'hover:text-text-main'))}
          icon={exclusion.loading ? <Loader2 size={14} className="animate-spin" /> : <EyeOff size={14} aria-hidden="true" />}
        />
      )}

      {ai && (excluded ? (
        <Slot label={t('ai_note_excluded')}><Sparkles size={14} className="text-text-main/15" aria-hidden="true" /></Slot>
      ) : (
        <IconButton
          size="sm"
          label={aiLabel}
          title={aiLabel}
          disabled={ai.loading}
          onClick={e => { e.stopPropagation(); ai.onClick(); }}
          className={cn(
            'w-6 h-6 rounded-lg transition-colors',
            ai.loading ? 'animate-pulse text-brand-soft' : ai.processed ? cn(LIT, 'hover:text-accent-danger') : cn(DIM, 'hover:text-brand-soft'),
          )}
          icon={ai.loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} aria-hidden="true" />}
        />
      ))}
    </div>
  );
}
