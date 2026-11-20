import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { StorageService } from '../../../core/services/StorageService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { SyncService } from '../../../core/services/SyncService';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { reportError } from '../../../shared/errors/reportError';
import { UnlockPrompt } from '../../../app/UnlockPrompt';
import { EncryptionPasswordModal } from '../../../app/EncryptionPasswordModal';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { Button } from '../../../shared/components/Button';
import { ModalShell } from '../../../shared/components/ModalShell';
import { emitDomainEvent } from '../../../core/events/domainEvents';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import { cn } from '../../../core/utils/utils';

export interface StorageDoc {
  localId?: string | undefined;
  cloudId?: string | undefined;
  hasLocal: boolean;
  hasCloud: boolean;
  hasPendingSync?: boolean | undefined;
  isTooLargeForSync?: boolean | undefined;
  /** D-5: «только на устройстве» по явному выбору — загрузка снимает пометку. */
  localOnly?: boolean | undefined;
}

export interface AIExclusion {
  excluded: boolean;
  loading: boolean;
  onClick: () => void;
}

export type StorageConfirmKind =
  | 'idle'
  | 'delete-local-only'
  | 'delete-local'
  | 'delete-cloud-only'
  | 'delete-cloud'
  | 'exclude-ai'
  | 'download-local';

export interface StorageConfirm {
  kind: StorageConfirmKind;
  title: string;
  hint: string;
  /** Кнопка подтверждения: скачать — позитивная, удалить/скрыть — опасная. */
  positive: boolean;
  confirmLabel: string;
}

export interface NoteStorageActions {
  uploading: boolean;
  downloading: boolean;
  /** Пиктограмма «на устройстве»: скачать копию или удалить локальную. */
  requestLocal: () => void;
  /** Пиктограмма «в облаке»: загрузить/отправить либо удалить облачную копию. */
  requestCloud: () => void;
  /** Скрыть от ИИ — с подтверждением; показать — сразу. */
  requestExclusion: () => void;
  confirm: StorageConfirm | null;
  handleConfirm: () => void;
  cancelConfirm: () => void;
  /** Модалка подтверждения + разблокировка сейфа / настройка шифрования. */
  dialogs: ReactNode;
}

/** DC-A3: вся семантика копий (загрузка, скачивание, удаление одной из копий,
 *  подтверждение, разблокировка сейфа) живёт здесь — из этого же хука строятся
 *  пункты меню в строке заметки и лист действий на телефоне, поэтому они не
 *  могут разойтись. */
export function useNoteStorageActions({
  doc,
  userId,
  onStorageChange,
  exclusion,
}: {
  doc: StorageDoc;
  userId: string;
  onStorageChange: () => void;
  exclusion?: AIExclusion | undefined;
}): NoteStorageActions {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { profile } = useAuthStatus();
  const hasEncryption = !!(profile?.encryptionMeta || (profile?.encryptionSalt && profile?.encryptedDataKey));
  const [confirmState, setConfirmState] = useState<StorageConfirmKind>('idle');
  // X-6: id заголовка — цель aria-labelledby в ModalShell; useId, чтобы две
  // открытые панели не спорили об один id.
  const confirmTitleId = useId();
  const [uploadBusy, setUploadBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<'upload' | 'download' | null>(null);
  const [showUnlock, setShowUnlock] = useState(false);
  const [showEncryptionSetup, setShowEncryptionSetup] = useState(false);

  const isTooLarge = doc.isTooLargeForSync === true;

  const doDownload = async () => {
    if (!doc.cloudId || !userId || userId.startsWith('guest_')) return;
    setDownloadBusy(true);
    try {
      await StorageService.addLocalCopy(userId, doc.cloudId);
      showToast(t('storage_downloaded_local'), 'success');
      onStorageChange();
    } catch (e) {
      const errStr = String((e as { message?: string })?.message || e);
      if (errStr.startsWith('LOCK_HELD') || errStr.includes('LOCK_HELD')) {
        showToast(t('storage_download_in_progress'), 'info');
      } else {
        reportError(e, { action: 'downloadLocalCopy', userId, cloudId: doc.cloudId });
        if (String(e).includes('LOCKED')) {
          setPendingAction('download');
          setShowUnlock(true);
        } else {
          showToast(t('error_generic_action'), 'error');
        }
      }
    } finally {
      setDownloadBusy(false);
    }
  };

  const doUpload = async () => {
    if (!doc.localId || !userId || userId.startsWith('guest_')) return;
    setUploadBusy(true);
    try {
      // D-5: до этого клика заметка числилась «только на устройстве», и
      // addCloudCopy законно отказывал. Нажатие «Загрузить на облако» — сменившийся
      // выбор пользователя, поэтому снимаем пометку здесь и только здесь.
      if (doc.localOnly) {
        await LocalDocumentService.clearLocalOnlyForUpload(doc.localId); // намеренно: при неудаче addCloudCopy вернёт LOCAL_ONLY
      }
      if (doc.hasPendingSync) {
        const ok = await SyncService.syncDocument(userId, doc.localId);
        if (ok) {
          showToast(t('storage_uploaded_cloud'), 'success');
        } else {
          showToast(t('storage_sync_error_activity_log'), 'error');
        }
      } else {
        const cloudId = await StorageService.addCloudCopy(userId, doc.localId);
        if (cloudId === 'LOCAL_ONLY') {
          showToast(t('storage_local_only_notice'), 'info');
        } else if (cloudId === 'TOMBSTONE') {
          showToast(t('storage_tombstone_notice'), 'info');
        } else if (cloudId) {
          showToast(t('storage_uploaded_cloud'), 'success');
        } else {
          showToast(t('storage_sync_error_activity_log'), 'error');
        }
      }
      onStorageChange();
    } catch (e) {
      reportError(e, { action: doc.hasPendingSync ? 'syncDocument' : 'addCloudCopy', userId, localId: doc.localId });
      showToast(t('storage_sync_error_activity_log'), 'error');
    } finally {
      setUploadBusy(false);
    }
  };

  const requireKeyForUpload = () => {
    setPendingAction('upload');
    if (hasEncryption) {
      setShowUnlock(true);
    } else {
      setShowEncryptionSetup(true);
    }
  };

  const requestLocal = () => {
    if (!doc.hasLocal && doc.hasCloud && doc.cloudId) {
      if (hasEncryption && !getSessionKey()) {
        setPendingAction('download');
        setShowUnlock(true);
        return;
      }
      setConfirmState('download-local');
      return;
    }
    if (!doc.hasLocal) return;
    setConfirmState(doc.hasLocal && !doc.hasCloud ? 'delete-local-only' : 'delete-local');
  };

  const requestCloud = () => {
    if (isTooLarge) {
      showToast(t('storage_too_large_cloud'), 'warning');
      return;
    }
    if (doc.hasCloud && !doc.hasPendingSync) {
      setConfirmState(doc.hasCloud && !doc.hasLocal ? 'delete-cloud-only' : 'delete-cloud');
      return;
    }
    if (!doc.localId || !userId || userId.startsWith('guest_')) return;
    if (!getSessionKey()) {
      requireKeyForUpload();
      return;
    }
    void doUpload();
  };

  const requestExclusion = () => {
    if (!exclusion || exclusion.loading) return;
    if (exclusion.excluded) {
      exclusion.onClick();
      return;
    }
    setConfirmState('exclude-ai');
  };

  const handleConfirm = async () => {
    const kind = confirmState;
    try {
      switch (kind) {
        case 'delete-local-only':
        case 'delete-cloud-only': {
          const res = await StorageService.trashDocument(userId, doc.localId, doc.cloudId);
          emitDomainEvent({ type: 'note.trashed', documentId: doc.localId || doc.cloudId! });
          useActivityLogStore.getState().addActivity('activity_note_trashed', undefined, 'info', 'archive');
          // Тот же итог, что у корзины из списка архива (useArchiveSessions.handleTrashSession).
          if (res.cloudSynced) showToast(t('archive_trash_moved'), 'success');
          else showToast(t('delete_local_only_queued'), 'warning');
          break;
        }
        case 'delete-local': {
          const ok = await StorageService.removeLocalCopy(doc.localId!);
          if (ok) {
            showToast(t('storage_deleted_local'), 'success');
          } else {
            showToast(t('error_generic_action'), 'error');
          }
          break;
        }
        case 'delete-cloud':
          await StorageService.removeCloudCopy(userId, doc.cloudId!);
          if (doc.localId) {
            // Deliberate removal from the cloud: record the intent, do not just
            // drop the link. `updateLinkedCloudId(id, '')` leaves the note looking
            // like one whose link was LOST, and the re-link pass restores it —
            // putting back the copy the user just asked to delete.
            await LocalDocumentService.unlinkFromCloud(doc.localId);
          }
          showToast(t('storage_deleted_cloud'), 'success');
          break;
        case 'exclude-ai':
          exclusion?.onClick();
          break;
        case 'download-local':
          await doDownload();
          break;
        case 'idle':
          break;
      }
      onStorageChange();
    } catch (e) {
      reportError(e, { action: kind, userId });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setConfirmState('idle');
    }
  };

  const confirm = (() => {
    switch (confirmState) {
      case 'idle':
        return null;
      case 'delete-local-only':
      case 'delete-cloud-only':
        return {
          kind: confirmState,
          title: t('storage_confirm_delete_only'),
          hint: t('storage_confirm_delete_only_hint'),
          positive: false,
          confirmLabel: t('storage_delete_confirm'),
        };
      case 'delete-local':
        return {
          kind: confirmState,
          title: t('storage_confirm_delete_local'),
          hint: t('storage_confirm_delete_local_hint'),
          positive: false,
          confirmLabel: t('storage_delete_confirm'),
        };
      case 'delete-cloud':
        return {
          kind: confirmState,
          title: t('storage_confirm_delete_cloud'),
          hint: t('storage_confirm_delete_cloud_hint'),
          positive: false,
          confirmLabel: t('storage_delete_confirm'),
        };
      case 'exclude-ai':
        return {
          kind: confirmState,
          title: t('ai_note_exclude_confirm'),
          hint: t('ai_note_exclude_confirm_hint'),
          positive: false,
          // X-6: имя кнопки подтверждения обязано отличаться от имени той
          // кнопки, что открыла подтверждение: раньше обе читались как
          // «Не показывать ИИ», и скринридер не различал «спросить» и «сделать».
          confirmLabel: t('ai_note_exclude_confirm_action'),
        };
      case 'download-local':
        return {
          kind: confirmState,
          title: t('storage_confirm_download_local'),
          hint: t('storage_confirm_download_local_hint'),
          positive: true,
          confirmLabel: t('storage_download_confirm'),
        };
    }
  })();

  const dialogs = (
    <>
      {/* X-6: подтверждение живёт в ModalShell — role=dialog, aria-modal,
          подпись и фокус-трап с возвратом фокуса. Прений оверлей был
          невидим для скринридеров: читалось только две кнопки с одинаковым
          именем («Не показывать ИИ»). */}
      <AnimatePresence>
        {confirm !== null && (
          <ModalShell
            open
            onClose={() => setConfirmState('idle')}
            labelId={confirmTitleId}
            z="critical"
          >
            <div className="mx-auto w-[320px] max-w-full bg-surface-card border border-border-subtle rounded-2xl p-5 shadow-lg">
              <div id={confirmTitleId} className="text-sm font-medium text-text-main mb-2">
                {confirm.title}
              </div>
              <div className="text-xs text-text-main/60 mb-4">
                {confirm.hint}
              </div>
              <div className="flex gap-2">
                <Button
                  variant={confirm.positive ? 'primary' : 'danger'}
                  size="sm"
                  onClick={() => void handleConfirm()}
                  className={cn(
                    "flex-1 py-2 rounded-xl text-sm font-medium",
                    confirm.positive
                      ? "bg-text-main text-surface-base hover:opacity-90 cursor-pointer"
                      : "bg-accent-danger/10 border border-accent-danger/20 text-accent-danger hover:bg-accent-danger/20"
                  )}
                >
                  {confirm.confirmLabel}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmState('idle')}
                  className="flex-1 py-2 rounded-xl border border-border-subtle text-text-main/60 text-sm hover:text-text-main"
                >
                  {t('common_cancel')}
                </Button>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showUnlock && hasEncryption && userId && !userId.startsWith('guest_') && (
          <UnlockPrompt
            uid={userId}
            onUnlocked={() => {
              setShowUnlock(false);
              if (pendingAction === 'download') {
                void doDownload();
              } else {
                void doUpload();
              }
            }}
            onClose={() => {
              setShowUnlock(false);
              setPendingAction(null);
            }}
          />
        )}
      </AnimatePresence>

      {showEncryptionSetup && userId && !userId.startsWith('guest_') && (
        <EncryptionPasswordModal
          mode="setup"
          userId={userId}
          context="cloud-sync"
          onDone={() => { setShowEncryptionSetup(false); void doUpload(); }}
          onClose={() => setShowEncryptionSetup(false)}
        />
      )}
    </>
  );

  return { uploading: uploadBusy, downloading: downloadBusy, requestLocal, requestCloud, requestExclusion, confirm, handleConfirm: () => { void handleConfirm(); }, cancelConfirm: () => setConfirmState('idle'), dialogs };
}
