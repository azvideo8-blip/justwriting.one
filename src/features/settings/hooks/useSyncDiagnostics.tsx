import { useState, useEffect, useCallback } from 'react';
import { Cloud, HardDrive, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { AIService } from '../../ai/services/AIService';
import { AISummaryService } from '../../ai/services/AISummaryService';
import { maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import type { AIDocumentSummary } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { DocumentService } from '../../../core/services/DocumentService';
import { SyncService } from '../../../core/services/SyncService';
import { StorageService } from '../../../core/services/StorageService';
import { VersionService } from '../../../core/services/VersionService';
import { getLocalDb } from '../../../core/storage/localDb';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { useAuthStatus } from '../../auth/contexts/AuthContext';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { encryptSingleDocument } from '../../../core/crypto/encryptMigration';

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
  status: 'synced' | 'pending' | 'mismatch' | 'local_only' | 'cloud_only' | 'cloud_missing';
  cloudEncrypted?: boolean | undefined;
}

export function useSyncDiagnostics({ userId }: { userId: string }) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { profile } = useAuthStatus();
  const hasEncryption = !!(profile?.encryptionMeta || (profile?.encryptionSalt && profile?.encryptedDataKey));

  const [loading, setLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [items, setItems] = useState<DiagnosticItem[]>([]);
  const [queueCount, setQueueCount] = useState(0);

  const [processedDocs, setProcessedDocs] = useState<Record<string, boolean>>({});
  const [processingDocId, setProcessingDocId] = useState<string | null>(null);
  const [readSummary, setReadSummary] = useState<AIDocumentSummary | null>(null);

  const loadAIStatus = useCallback(async () => {
    try {
      const statusMap = await AISummaryService.hasAll();
      setProcessedDocs(statusMap);
    } catch (e) {
      console.error('[SyncDiagnostics] Failed to load AI status:', e);
    }
  }, []);

  const fetchData = useCallback(async () => {
    if (!userId || userId.startsWith('guest_')) return;
    setLoading(true);
    try {
      const [localDocs, cloudDocs, queue] = await Promise.all([
        getLocalDb().then(db => db.getAll('documents')).catch(e => {
          console.error('[SyncDiagnostics] Local docs fetch failed:', e);
          return [];
        }),
        DocumentService.getUserDocuments(userId).catch(e => {
          console.error('[SyncDiagnostics] Cloud fetch failed:', e);
          return [];
        }),
        getLocalDb().then(db => db.getAll('syncQueue')).catch(e => {
          console.error('[SyncDiagnostics] Queue fetch failed:', e);
          return [];
        }),
      ]);

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
            status = 'cloud_missing';
          }
        }

        itemsMap.set(localDoc.id, {
          id: localDoc.id,
          title: localDoc.title || t('common_untitled') || 'Untitled',
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
        });
      }

      // 2. Process cloud documents not linked to any local document
      for (const cloudDoc of cloudDocs) {
        const isLinked = localDocs.some(l => l.linkedCloudId === cloudDoc.id);
        if (!isLinked) {
          itemsMap.set(cloudDoc.id, {
            id: cloudDoc.id,
            title: cloudDoc.title || t('common_untitled') || 'Untitled',
            cloudId: cloudDoc.id,
            hasLocal: false,
            hasCloud: true,
            cloudVersion: cloudDoc.currentVersion,
            cloudWords: cloudDoc.totalWords,
            inQueue: false,
            status: 'cloud_only',
          });
        }
      }

      const builtItems = Array.from(itemsMap.values());

      // Determine cloud encryption state per item
      await Promise.all(builtItems.map(async (item) => {
        if (item.hasCloud && item.cloudId) {
          try {
            const latest = await VersionService.getLatestVersion(userId, item.cloudId);
            item.cloudEncrypted = !!(latest as unknown as { _encrypted?: boolean })?._encrypted;
          } catch (e) {
            console.error('[SyncDiagnostics] Encryption check failed:', e);
          }
        }
      }));

      setItems(builtItems.sort((a, b) => b.title.localeCompare(a.title)));

      await loadAIStatus();
    } catch (e) {
      console.error('[SyncDiagnostics] Error fetching diagnostics:', e);
      showToast(t('error_generic_action') || 'Error fetching status', 'error');
    } finally {
      setLoading(false);
    }
  }, [userId, t, showToast, loadAIStatus]);

  useEffect(() => {
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
      if (item.status === 'pending' || item.status === 'mismatch') {
        await SyncService.syncDocument(userId, item.localId, hasEncryption);
      } else {
        await StorageService.addCloudCopy(userId, item.localId, hasEncryption);
      }
      showToast(t('storage_uploaded_cloud') || 'Sync completed', 'success');
      await fetchData();
    } catch (e) {
      console.error('[SyncDiagnostics] Sync failed:', e);
      showToast(t('error_generic_action') || 'Sync failed', 'error');
    } finally {
      setSyncingId(null);
    }
  };

  const handleDownloadItem = async (item: DiagnosticItem) => {
    if (!item.cloudId) return;
    setSyncingId(item.id);
    try {
      await StorageService.addLocalCopy(userId, item.cloudId);
      showToast('Downloaded copy to device', 'success');
      await fetchData();
    } catch (e) {
      console.error('[SyncDiagnostics] Download failed:', e);
      showToast(t('error_generic_action') || 'Download failed', 'error');
    } finally {
      setSyncingId(null);
    }
  };

  const handleUnlinkItem = async (item: DiagnosticItem) => {
    if (!item.localId) return;
    if (!window.confirm('Unlink this document from cloud? This will keep it as local-only.')) return;
    setSyncingId(item.id);
    try {
      await LocalDocumentService.updateLinkedCloudId(item.localId, '');
      showToast('Unlinked from cloud copy', 'success');
      await fetchData();
    } catch (e) {
      console.error('[SyncDiagnostics] Unlink failed:', e);
      showToast(t('error_generic_action') || 'Unlink failed', 'error');
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
      const res = await encryptSingleDocument(userId, item.cloudId);
      showToast(`Encrypted ${res.encrypted} versions in the cloud`, 'success');
      await fetchData();
    } catch (e) {
      console.error('[SyncDiagnostics] Encryption failed:', e);
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
      await fetchData();
    } catch (e) {
      console.error('[SyncDiagnostics] Clear queue item failed:', e);
      showToast(t('error_generic_action') || 'Clear queue item failed', 'error');
    } finally {
      setSyncingId(null);
    }
  };

  const handleSyncAllQueue = async () => {
    setLoading(true);
    try {
      await SyncService.syncPending(userId);
      showToast('Synced pending queue items', 'success');
      await fetchData();
    } catch (e) {
      console.error('[SyncDiagnostics] Sync queue failed:', e);
      showToast(t('error_generic_action') || 'Sync failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleProcessDocument = async (item: DiagnosticItem) => {
    if (!item.localId) {
      showToast('Документ должен быть сохранен на устройстве для обработки', 'error');
      return;
    }
    setProcessingDocId(item.id);
    try {
      const db = await getLocalDb();
      const versions = await db.getAllFromIndex('versions', 'by-document', item.localId);
      if (versions.length === 0) {
        showToast('Не найден контент документа для обработки', 'error');
        return;
      }
      versions.sort((a, b) => b.version - a.version);
      const latestVersion = versions[0];

      let decryptedVer;
      try {
        decryptedVer = await maybeDecrypt(latestVersion as unknown as Record<string, unknown>, ['content'], []);
      } catch (decryptErr) {
        if (decryptErr instanceof Error && decryptErr.message.includes('LOCKED')) {
          showToast('⚠️ Пожалуйста, сначала разблокируйте сейф для расшифровки контента', 'error');
        } else {
          showToast('Ошибка расшифровки документа', 'error');
        }
        return;
      }

      const content = decryptedVer.content as string;
      if (!content || content.trim().length < 50) {
        showToast('Текст документа слишком короткий для ИИ-анализа (минимум 50 символов)', 'error');
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
        await AISummaryService.save(summary);

        const doc = await db.get('documents', item.localId);
        if (doc) {
          await db.put('documents', { ...doc, aiProcessed: true });
        }

        showToast('Анализ ИИ завершен успешно', 'success');
        await loadAIStatus();
        await fetchData();
      } else {
        showToast('Не удалось обработать: ' + result.error, 'error');
      }
    } catch (e) {
      console.error('[SyncDiagnostics] AI processing failed:', e);
      showToast('Ошибка при запуске обработки ИИ', 'error');
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
        showToast('Саммари не найдено', 'error');
      }
    } catch (e) {
      console.error('[SyncDiagnostics] Failed to load summary:', e);
      showToast('Не удалось прочитать результаты анализа', 'error');
    }
  };

  const getStatusBadge = (status: DiagnosticItem['status']) => {
    switch (status) {
      case 'synced':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-green-500/10 text-green-400 border border-green-500/20">
            <CheckCircle2 size={10} />
            Synced
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
            <AlertTriangle size={10} />
            Pending Sync
          </span>
        );
      case 'mismatch':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
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
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Cloud size={10} />
            Cloud Only
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
    loading, syncingId, items, queueCount,
    processedDocs, processingDocId, readSummary, setReadSummary,
    hasEncryption,
    fetchData, handleSyncItem, handleDownloadItem, handleUnlinkItem,
    handleEncryptItem, handleClearQueueItem, handleSyncAllQueue,
    handleProcessDocument, handleReadSummary,
    getStatusBadge,
  };
}
