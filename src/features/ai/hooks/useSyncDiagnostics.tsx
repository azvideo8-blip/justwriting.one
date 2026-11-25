import { useState, useEffect, useCallback, useRef } from 'react';
import { Cloud, HardDrive, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { AIService } from '../services/AIService';
import { AISummaryService } from '../services/AISummaryService';
import { maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import type { AIDocumentSummary } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { DocumentService } from '../../../core/services/DocumentService';
import { isUnreadableCloudList } from '../../../core/services/cloudListPartial';
import { SyncService } from '../../../core/services/SyncService';
import { StorageService } from '../../../core/services/StorageService';
import { VersionService } from '../../../core/services/VersionService';
import { getLocalDb } from '../../../core/storage/localDb';
import { toDate } from '../../../core/utils/dateUtils';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { encryptSingleDocument } from '../../../core/crypto/encryptMigration';
import { reportError } from '../../../shared/errors/reportError';
import { getSyncRevDeferred } from '../../../core/sync/revCursor';

export interface DiagnosticItem {
  id: string;
  title: string;
  localId?: string | undefined;
  cloudId?: string | undefined;
  hasLocal: boolean;
  hasCloud: boolean;
  localVersion?: number | undefined;
  cloudVersion?: number | undefined;
  localWords?: number | undefined;
  cloudWords?: number | undefined;
  inQueue: boolean;
  queueItemId?: string | undefined;
  status: 'synced' | 'pending' | 'mismatch' | 'local_only' | 'cloud_only' | 'cloud_missing' | 'cloud_unknown';
  cloudEncrypted?: boolean | undefined;
  date?: number | undefined;
}

export function useSyncDiagnostics({ userId }: { userId: string }) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirmDialog();
  const { profile } = useAuthStatus();
  const hasEncryption = !!(profile?.encryptionMeta || (profile?.encryptionSalt && profile?.encryptedDataKey));

  const [loading, setLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [items, setItems] = useState<DiagnosticItem[]>([]);
  const [cloudUnavailable, setCloudUnavailable] = useState(false);
  // Локальное чтение (заметки, очередь, отложенные) упало — не «пусто» и не «0 в очереди».
  const [localReadFailed, setLocalReadFailed] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [discrepancyCount, setDiscrepancyCount] = useState(0);
  // S1-12: строки облака, которые забор по rev отложил как стойко нечитаемые.
  const [deferredCount, setDeferredCount] = useState(0);

  const [processedDocs, setProcessedDocs] = useState<Record<string, boolean>>({});
  const [processingDocId, setProcessingDocId] = useState<string | null>(null);
  const [readSummary, setReadSummary] = useState<AIDocumentSummary | null>(null);

  const loadAIStatus = useCallback(async () => {
    try {
      const statusMap = await AISummaryService.hasAll();
      setProcessedDocs(statusMap);
    } catch (e) {
      reportError(e, { action: '[SyncDiagnostics] Failed to load AI status' });
    }
  }, []);

  const fetchData = useCallback(async () => {
    if (!userId || userId.startsWith('guest_')) return;
    setLoading(true);
    let cloudReadFailed = false;
    let localFailed = false;
    setCloudUnavailable(false);
    try {
      const [localDocs, cloudDocs, queue, cloudDiscrepancies, deferredRows] = await Promise.all([
        getLocalDb().then(db => db.getAll('documents')).catch(e => {
          reportError(e, { action: '[SyncDiagnostics] Local docs fetch failed' });
          localFailed = true;
          return [];
        }),
        // A failed read must not look like an empty cloud: every linked note
        // would be reported as "Cloud Copy Lost" next to an Unlink button, and
        // unlinking on that false reading destroys the only mapping back to a
        // cloud copy that is actually still there.
        DocumentService.getUserDocuments(userId).catch(e => {
          reportError(e, { action: '[SyncDiagnostics] Cloud fetch failed' });
          cloudReadFailed = true;
          // R-2: прочитанная часть показывается; «нет в облаке» при этом не выносится.
          return isUnreadableCloudList(e) ? e.docs : [];
        }),
        getLocalDb().then(db => db.getAll('syncQueue')).catch(e => {
          reportError(e, { action: '[SyncDiagnostics] Queue fetch failed' });
          localFailed = true;
          return [];
        }),
        DocumentService.getCloudVersionDiscrepancyCount(userId).catch(e => {
          // R4-7: не «0 расхождений», а «облако не прочитано».
          reportError(e, { action: '[SyncDiagnostics] Version discrepancy check failed' });
          cloudReadFailed = true;
          return 0;
        }),
        getSyncRevDeferred(userId).catch(e => {
          reportError(e, { action: '[SyncDiagnostics] Deferred rows fetch failed' });
          localFailed = true;
          return [];
        }),
      ]);
      setDeferredCount(deferredRows.length);

      setCloudUnavailable(cloudReadFailed);
      setLocalReadFailed(localFailed);
      setDiscrepancyCount(cloudDiscrepancies);

      const filteredQueue = queue.filter(item => !item.id.startsWith('migrated_') && !item.id.startsWith('lock_cloud_'));
      setQueueCount(filteredQueue.length);

      const itemsMap = new Map<string, DiagnosticItem>();

      // 1. Process local documents
      for (const localDoc of localDocs) {
        const cloudDoc = localDoc.linkedCloudId
          ? cloudDocs.find(c => c.id === localDoc.linkedCloudId)
          : undefined;

        const docQueueItems = filteredQueue.filter(q => q.documentId === localDoc.id);
        const inQueue = docQueueItems.length > 0;
        const queueItemId = inQueue ? docQueueItems[0]!.id : undefined;

        let status: DiagnosticItem['status'] = 'local_only';
        if (localDoc.linkedCloudId) {
          if (cloudDoc) {
            if (inQueue) {
              status = 'pending';
            } else if (localDoc.currentVersion !== cloudDoc.currentVersion || localDoc.totalWords !== cloudDoc.totalWords) {
              status = 'mismatch';
            } else {
              status = 'synced';
            }
          } else {
            status = cloudReadFailed ? 'cloud_unknown' : 'cloud_missing';
          }
        }

        itemsMap.set(localDoc.id, {
          id: localDoc.id,
          title: localDoc.title || t('common_untitled'),
          localId: localDoc.id,
          cloudId: localDoc.linkedCloudId || undefined,
          hasLocal: true,
          hasCloud: !!cloudDoc,
          localVersion: localDoc.currentVersion,
          cloudVersion: cloudDoc?.currentVersion,
          localWords: localDoc.totalWords,
          cloudWords: cloudDoc?.totalWords,
          inQueue,
          queueItemId,
          status,
          date: localDoc.lastSessionAt || localDoc.firstSessionAt || undefined,
        });
      }

      // 2. Process cloud documents not linked to any local document
      for (const cloudDoc of cloudDocs) {
        const isLinked = localDocs.some(l => l.linkedCloudId === cloudDoc.id);
        if (!isLinked) {
          itemsMap.set(cloudDoc.id, {
            id: cloudDoc.id,
            title: cloudDoc.title || t('common_untitled'),
            cloudId: cloudDoc.id,
            hasLocal: false,
            hasCloud: true,
            cloudVersion: cloudDoc.currentVersion,
            cloudWords: cloudDoc.totalWords,
            inQueue: false,
            status: 'cloud_only',
            date: toDate(cloudDoc.lastSessionAt)?.getTime(),
          });
        }
      }

      const builtItems = Array.from(itemsMap.values());

      // Encryption probes are deferred to when the user explicitly requests them
      // to avoid O(N) reads on every page load.

      setItems(builtItems.sort((a, b) => b.title.localeCompare(a.title)));

      await loadAIStatus();
    } catch (e) {
      reportError(e, { action: '[SyncDiagnostics] Error fetching diagnostics' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setLoading(false);
    }
  }, [userId, t, showToast, loadAIStatus]);

  const hasFetched = useRef(false);
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void fetchData();
  }, [fetchData]);

  const handleSyncItem = async (item: DiagnosticItem) => {
    if (!item.localId) return;
    if (hasEncryption && !getSessionKey()) {
      showToast('⚠️ Please unlock your vault first', 'error');
      return;
    }
    setSyncingId(item.id);
    try {
      let ok = true;
      if (item.status === 'pending' || item.status === 'mismatch') {
        ok = await SyncService.syncDocument(userId, item.localId);
      } else {
        // 'LOCAL_ONLY' / 'TOMBSTONE' — отказ, а не id облачной копии.
        const cloudId = await StorageService.addCloudCopy(userId, item.localId);
        ok = !!cloudId && cloudId !== 'LOCAL_ONLY' && cloudId !== 'TOMBSTONE';
      }
      if (ok) {
        showToast(t('storage_uploaded_cloud'), 'success');
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'synced', hasCloud: true, cloudId: item.localId, inQueue: false } : i));
      } else {
        showToast(t('error_generic_action'), 'error');
      }
    } catch (e) {
      reportError(e, { action: '[SyncDiagnostics] Sync failed' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setSyncingId(null);
    }
  };

  const handleDownloadItem = async (item: DiagnosticItem) => {
    if (!item.cloudId) return;
    setSyncingId(item.id);
    try {
      const { skippedVersions } = await StorageService.addLocalCopy(userId, item.cloudId);
      if (skippedVersions > 0) showToast(t('storage_download_versions_skipped', { count: skippedVersions }), 'warning');
      else showToast('Downloaded copy to device', 'success');
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, hasLocal: true, status: 'synced', localId: item.cloudId } : i));
    } catch (e) {
      reportError(e, { action: '[SyncDiagnostics] Download failed' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setSyncingId(null);
    }
  };

  const handleUnlinkItem = async (item: DiagnosticItem) => {
    if (!item.localId) return;
    const ok = await confirmDialog({
      title: t('admin_sync_unlink_confirm_title'),
      message: t('admin_sync_unlink_confirm_message'),
    });
    if (!ok) return;
    setSyncingId(item.id);
    try {
      await LocalDocumentService.unlinkFromCloud(item.localId);
      showToast('Unlinked from cloud copy', 'success');
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'local_only', cloudId: undefined, hasCloud: false } : i));
    } catch (e) {
      reportError(e, { action: '[SyncDiagnostics] Unlink failed' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setSyncingId(null);
    }
  };

  const handleEncryptItem = async (item: DiagnosticItem) => {
    if (!item.cloudId) return;
    if (!getSessionKey()) {
      showToast('⚠️ Please unlock your vault first', 'error');
      return;
    }
    setSyncingId(item.id);
    try {
      // The encryption state is probed here, for this one note, rather than for
      // every note on load — that probe was a read per note on every panel open.
      // Doing it before the write also stops a needless re-encrypt of a document
      // that is already encrypted, which is what the missing badge invited.
      const latest = await VersionService.getLatestVersion(userId, item.cloudId);
      // 'PARSE_FAILED' — строка не читается целиком; _encrypted у неё не спросить.
      if (latest !== 'PARSE_FAILED' && (latest as unknown as { _encrypted?: boolean } | null)?._encrypted) {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, cloudEncrypted: true } : i));
        showToast(t('admin_sync_toast_already_encrypted'), 'success');
        return;
      }
      const res = await encryptSingleDocument(userId, item.cloudId);
      // Ошибки версий не бросают — без проверки «Encrypted N» зеленел над недошифрованной.
      if (res.errors > 0) {
        showToast(`Encrypted ${res.encrypted} versions in the cloud`, 'warning');
        return;
      }
      showToast(`Encrypted ${res.encrypted} versions in the cloud`, 'success');
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, cloudEncrypted: true } : i));
    } catch (e) {
      reportError(e, { action: '[SyncDiagnostics] Encryption failed' });
      showToast('Encryption failed. Make sure your vault is unlocked.', 'error');
    } finally {
      setSyncingId(null);
    }
  };

  const handleClearQueueItem = async (item: DiagnosticItem) => {
    if (!item.queueItemId) return;
    setSyncingId(item.id);
    try {
      const db = await getLocalDb();
      await db.delete('syncQueue', item.queueItemId);
      showToast('Cleared task from sync queue', 'success');
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, inQueue: false, queueItemId: undefined, status: i.hasCloud ? (i.localVersion !== i.cloudVersion ? 'mismatch' : 'synced') : 'local_only' } : i));
    } catch (e) {
      reportError(e, { action: '[SyncDiagnostics] Clear queue item failed' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setSyncingId(null);
    }
  };

  const handleSyncAllQueue = async () => {
    setLoading(true);
    try {
      const res = await SyncService.syncPending(userId);
      if (res.skippedReason === 'sync_disabled') {
        showToast(t('sync_queue_disabled'), 'error');
      } else if (res.skippedReason === 'offline') {
        // D1-3: офлайн — пауза, а не попытка: ничего не ушло, но и «пусто» это не так.
        showToast(t('admin_queue_toast_offline'), 'error');
      } else if (res.skippedReason === 'vault_locked') {
        // Заметки ждут ключа — это не «очередь пуста».
        showToast(t('settings_sync_vault_locked'), 'error');
      } else if (res.skippedReason === 'in_progress') {
        showToast(t('sync_already_running'), 'info');
      } else if (res.failed > 0) {
        showToast(t('sync_queue_partial', { drained: String(res.drained), failed: String(res.failed) }), 'error');
      } else if (res.drained === 0) {
        showToast(t('sync_queue_empty'), 'success');
      } else {
        showToast(t('sync_queue_processed', { drained: String(res.drained) }), 'success');
      }
      await fetchData();
    } catch (e) {
      reportError(e, { action: '[SyncDiagnostics] Sync queue failed' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleProcessDocument = async (item: DiagnosticItem) => {
    if (!item.localId) {
      showToast(t('admin_sync_toast_need_local'), 'error');
      return;
    }
    setProcessingDocId(item.id);
    try {
      const db = await getLocalDb();
      const versions = await db.getAllFromIndex('versions', 'by-document', item.localId);
      if (versions.length === 0) {
        showToast(t('admin_sync_toast_no_content'), 'error');
        return;
      }
      versions.sort((a, b) => b.version - a.version);
      const latestVersion = versions[0];

      let decryptedVer;
      try {
        decryptedVer = await maybeDecrypt(latestVersion as unknown as Record<string, unknown>, ['content'], []);
      } catch (decryptErr) {
        if (decryptErr instanceof Error && decryptErr.message.includes('LOCKED')) {
          showToast(t('admin_sync_toast_unlock_vault'), 'error');
        } else {
          showToast(t('admin_sync_toast_decrypt_error'), 'error');
        }
        return;
      }

      const content = decryptedVer.content as string;
      if (!content || content.trim().length < 50) {
        showToast(t('admin_sync_toast_too_short'), 'error');
        return;
      }

      const result = await AIService.summarize({ content });
      if (result.ok) {
        const summary: AIDocumentSummary = {
          documentId: item.localId,
          tone: result.summary.tone,
          frequentWords: result.summary.frequentWords,
          insights: result.summary.insights,
          themes: result.summary.themes,
          extractedFacts: result.summary.extractedFacts ?? [],
          processedAt: Date.now(),
        };
        const saved = await AISummaryService.save(summary);
        // NB-17 №8: заметка исключена из ИИ — разбора нет, зелёное «завершено» ложь.
        if (saved === 'skipped') {
          showToast(t('admin_sync_toast_ai_skipped'), 'warning');
          return;
        }

        const tx = db.transaction('documents', 'readwrite');
        const fresh = await tx.store.get(item.localId);
        if (fresh) {
          await tx.store.put({ ...fresh, aiProcessed: true });
        }
        await tx.done;

        showToast(t('admin_sync_toast_ai_done'), 'success');
        await loadAIStatus();
        await fetchData();
      } else {
        showToast(t('admin_sync_toast_ai_fail', { error: result.error }), 'error');
      }
    } catch (e) {
      reportError(e, { action: '[SyncDiagnostics] AI processing failed' });
      showToast(t('admin_sync_toast_ai_error'), 'error');
    } finally {
      setProcessingDocId(null);
    }
  };

  const handleReadSummary = async (documentId: string) => {
    try {
      const summary = await AISummaryService.get(documentId);
      if (summary) {
        setReadSummary(summary);
      } else {
        showToast(t('admin_sync_toast_no_summary'), 'error');
      }
    } catch (e) {
      reportError(e, { action: '[SyncDiagnostics] Failed to load summary' });
      showToast(t('admin_sync_toast_load_summary_error'), 'error');
    }
  };

  const getStatusBadge = (status: DiagnosticItem['status']) => {
    switch (status) {
      case 'synced':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-accent-success/10 text-accent-success border border-accent-success/20">
            <CheckCircle2 size={10} />
            Synced
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-accent-warning/10 text-accent-warning border border-accent-warning/20 animate-pulse">
            <AlertTriangle size={10} />
            Pending Sync
          </span>
        );
      case 'mismatch':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-accent-warning/10 text-accent-warning border border-accent-warning/20">
            <AlertTriangle size={10} />
            Unsynced Edits
          </span>
        );
      case 'local_only':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-gray-500/10 text-gray-400 border border-gray-500/20">
            <HardDrive size={10} />
            Device Only
          </span>
        );
      case 'cloud_only':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-accent-info/10 text-accent-info border border-accent-info/20">
            <Cloud size={10} />
            Cloud Only
          </span>
        );
      case 'cloud_unknown':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-accent-warning/10 text-accent-warning border border-accent-warning/20">
            <AlertTriangle size={10} />
            {t('admin_sync_status_cloud_unknown')}
          </span>
        );
      case 'cloud_missing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-accent-danger/10 text-accent-danger border border-accent-danger/20">
            <AlertTriangle size={10} />
            Cloud Copy Lost
          </span>
        );
    }
  };

  return {
    loading, syncingId, items, queueCount, discrepancyCount, deferredCount, cloudReadFailed: cloudUnavailable, localReadFailed,
    processedDocs, processingDocId, readSummary, setReadSummary,
    hasEncryption,
    fetchData, handleSyncItem, handleDownloadItem, handleUnlinkItem,
    handleEncryptItem, handleClearQueueItem, handleSyncAllQueue,
    handleProcessDocument, handleReadSummary,
    getStatusBadge,
  };
}
