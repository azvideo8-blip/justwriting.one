import { useState, useEffect, useCallback } from 'react';
import { Cloud, HardDrive, RefreshCw, AlertTriangle, CheckCircle2, Upload, Download, Trash2, Loader2, Link2Off, Lock, Sparkles, Eye, X } from 'lucide-react';
import { AIService } from '../../ai/services/AIService';
import { AISummaryService } from '../../ai/services/AISummaryService';
import { maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import type { AIDocumentSummary } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { DocumentService } from '../../../core/services/DocumentService';
import { SyncService } from '../../../core/services/SyncService';
import { StorageService } from '../../../core/services/StorageService';
import { SessionService } from '../../../core/services/SessionService';
import { VersionService } from '../../writing/services/VersionService';
import { getLocalDb } from '../../../core/storage/localDb';
import { useLanguage } from '../../../core/i18n';
import { useToast } from '../../../shared/components/Toast';
import { useAuthStatus } from '../../auth/contexts/AuthContext';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { cn } from '../../../core/utils/utils';
import { encryptSingleDocument } from '../../../core/crypto/encryptMigration';
import { Session } from '../../../types';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';


interface SyncDiagnosticsProps {
  userId: string;
}

interface DiagnosticItem {
  id: string; // local ID if local exists, else cloud ID
  title: string;
  localId?: string;
  cloudId?: string;
  hasLocal: boolean;
  hasCloud: boolean;
  localVersion?: number;
  cloudVersion?: number;
  localWords?: number;
  cloudWords?: number;
  inQueue: boolean;
  queueItemId?: string;
  status: 'synced' | 'pending' | 'mismatch' | 'local_only' | 'cloud_only' | 'cloud_missing' | 'legacy_session';
  rawSession?: Session;
  cloudEncrypted?: boolean;
}

export function SyncDiagnostics({ userId }: SyncDiagnosticsProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { profile } = useAuthStatus();
  const { layoutMode } = useLayoutMode();
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
      const [localDocs, cloudDocs, queue, legacyResult] = await Promise.all([
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
        SessionService.getAllSessions(userId, 500).catch(e => {
          console.error('[SyncDiagnostics] Legacy sessions fetch failed:', e);
          return { sessions: [] };
        })
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
        const queueItemId = inQueue ? docQueueItems[0].id : undefined;

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

      // 3. Process legacy cloud sessions
      const legacySessions = legacyResult.sessions;
      for (const s of legacySessions) {
        if (!itemsMap.has(s.id)) {
          itemsMap.set(s.id, {
            id: s.id,
            title: s.title || t('common_untitled') || 'Untitled',
            hasLocal: false,
            hasCloud: true,
            cloudWords: s.wordCount,
            inQueue: false,
            status: 'legacy_session',
            rawSession: s,
          });
        }
      }

      const builtItems = Array.from(itemsMap.values());

      // Determine cloud encryption state per item
      await Promise.all(builtItems.map(async (item) => {
        if (item.status === 'legacy_session') {
          item.cloudEncrypted = !!(item.rawSession as unknown as { _encrypted?: boolean })?._encrypted;
          return;
        }
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
    fetchData();
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

  const handleMigrateLegacySession = async (item: DiagnosticItem) => {
    if (!item.rawSession) return;
    if (hasEncryption && !getSessionKey()) {
      showToast('⚠️ Please unlock your vault first to decrypt and migrate', 'error');
      return;
    }
    setSyncingId(item.id);
    try {
      await SyncService.migrateLegacySession(userId, item.rawSession, hasEncryption);
      showToast('Legacy session successfully migrated to versioned document', 'success');
      await fetchData();
    } catch (e) {
      console.error('[SyncDiagnostics] Migration failed:', e);
      showToast('Migration failed. Make sure your vault is unlocked.', 'error');
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
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-red-500/10 text-red-400 border border-red-500/20">
            <AlertTriangle size={10} />
            Cloud Copy Lost
          </span>
        );
      case 'legacy_session':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Cloud size={10} />
            Legacy Cloud Session
          </span>
        );
    }
  };

  return (
    <div className="space-y-4 p-4 rounded-xl border border-border-subtle bg-surface-card/30">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-text-main/40">
            Compare local IndexedDB cache with Cloud Firestore collections.
          </div>
          {hasEncryption && !getSessionKey() && (
            <div className="text-label-sm text-amber-500/80 mt-1 font-medium flex items-center gap-1">
              <AlertTriangle size={11} />
              Vault is locked. Decrypted sync is disabled until unlocked.
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {queueCount > 0 && (
            <button
              onClick={handleSyncAllQueue}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition-colors"
            >
              Sync Queue ({queueCount})
            </button>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-1.5 rounded-lg border border-border-subtle hover:bg-surface-base/10 text-text-main/60 hover:text-text-main transition-colors disabled:opacity-50"
            title="Refresh diagnostics"
          >
            <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <Loader2 size={24} className="animate-spin text-text-main/30" />
          <span className="text-xs text-text-main/40">Analyzing database differences...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-6 text-xs text-text-main/30">
          No documents found on this device or in the cloud.
        </div>
      ) : layoutMode === 'mobile' ? (
        <div className="space-y-3">
          {items.map(item => {
            const isSyncing = syncingId === item.id;
            return (
              <div key={item.id} className="p-3 rounded-lg border border-border-subtle bg-surface-base/5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-text-main text-sm truncate" title={item.title}>
                      {item.title}
                    </h4>
                    <span className="text-label text-text-main/30 font-mono block truncate mt-0.5">{item.id}</span>
                  </div>
                  <div className="shrink-0">
                    {getStatusBadge(item.status)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-label-sm text-text-main/60 bg-surface-card/20 p-2 rounded">
                  <div>
                    <span className="text-text-main/40 block">Versions (L / C)</span>
                    <span className="font-mono text-text-main">
                      {item.hasLocal ? item.localVersion : '-'} / {item.hasCloud ? item.cloudVersion : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-main/40 block">Words (L / C)</span>
                    <span className="font-mono text-text-main">
                      {item.hasLocal ? item.localWords : '-'} / {item.hasCloud ? item.cloudWords : '-'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {isSyncing ? (
                    <div className="flex items-center justify-center w-full py-2">
                      <Loader2 size={16} className="animate-spin text-[var(--brand-soft)]" />
                    </div>
                  ) : (
                    <>
                      {item.status === 'local_only' && (
                        <button
                          onClick={() => handleSyncItem(item)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-semibold border border-blue-500/20 transition-colors min-h-[44px]"
                        >
                          <Upload size={14} />
                          Upload
                        </button>
                      )}
                      {item.status === 'cloud_only' && (
                        <button
                          onClick={() => handleDownloadItem(item)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 text-xs font-semibold border border-green-500/20 transition-colors min-h-[44px]"
                        >
                          <Download size={14} />
                          Download
                        </button>
                      )}
                      {(item.status === 'pending' || item.status === 'mismatch') && (
                        <button
                          onClick={() => handleSyncItem(item)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-semibold border border-amber-500/20 transition-colors min-h-[44px]"
                        >
                          <RefreshCw size={14} />
                          Sync
                        </button>
                      )}
                      {item.status === 'cloud_missing' && (
                        <button
                          onClick={() => handleUnlinkItem(item)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold border border-red-500/20 transition-colors min-h-[44px]"
                        >
                          <Link2Off size={14} />
                          Unlink
                        </button>
                      )}
                      {item.status === 'legacy_session' && (
                        <button
                          onClick={() => handleMigrateLegacySession(item)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 text-xs font-semibold border border-purple-500/20 transition-colors min-h-[44px]"
                        >
                          <RefreshCw size={14} />
                          Migrate
                        </button>
                      )}
                      {hasEncryption && item.hasCloud && item.cloudId && (
                        item.cloudEncrypted ? (
                          <span className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/10 text-green-400 text-xs font-semibold border border-green-500/20 min-h-[44px]">
                            <Lock size={14} />
                            Encrypted
                          </span>
                        ) : (
                          <button
                            onClick={() => handleEncryptItem(item)}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-semibold border border-amber-500/20 transition-colors min-h-[44px]"
                          >
                            <Lock size={14} />
                            Encrypt
                          </button>
                        )
                      )}
                      {item.inQueue && (
                        <button
                          onClick={() => handleClearQueueItem(item)}
                          className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors min-h-[44px] flex items-center justify-center"
                          title="Remove item from sync queue"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-border-subtle/50 pt-2 text-label-sm">
                  <span className="text-text-main/40 font-medium">AI Analysis</span>
                  <div>
                    {processedDocs[item.id] ? (
                      <div className="flex items-center gap-2">
                        <span className="text-green-400 font-medium">Processed</span>
                        <button
                          onClick={() => handleReadSummary(item.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-card border border-border-subtle text-text-main/70 text-xs font-medium"
                        >
                          <Eye size={14} />
                          Read Summary
                        </button>
                      </div>
                    ) : processingDocId === item.id ? (
                      <div className="flex items-center gap-1.5 text-text-main/40">
                        <Loader2 size={14} className="animate-spin text-brand-soft" />
                        Processing...
                      </div>
                    ) : item.hasLocal ? (
                      <button
                        onClick={() => handleProcessDocument(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-soft/10 border border-brand-soft/20 text-brand-soft text-xs font-semibold"
                      >
                        <Sparkles size={14} />
                        Analyze with AI
                      </button>
                    ) : (
                      <span className="text-text-main/20 text-xs">Needs Local Copy</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border-subtle text-text-main/40 font-medium">
                <th className="py-2 px-3">Note Title</th>
                <th className="py-2 px-2 text-center">Location</th>
                <th className="py-2 px-2 text-center">Versions (L/C)</th>
                <th className="py-2 px-2 text-center">Words (L/C)</th>
                <th className="py-2 px-2 text-center">AI</th>
                <th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const isSyncing = syncingId === item.id;
                return (
                  <tr key={item.id} className="border-b border-border-subtle/50 hover:bg-surface-base/5 text-text-main/80">
                    <td className="py-2.5 px-3 max-w-[150px] truncate" title={item.title}>
                      <span className="font-medium text-text-main">{item.title}</span>
                      <div className="text-[9px] text-text-main/20 font-mono truncate">{item.id}</div>
                    </td>
                    <td className="py-2.5 px-2 text-center whitespace-nowrap">
                      {getStatusBadge(item.status)}
                    </td>
                    <td className="py-2.5 px-2 text-center font-mono">
                      {item.hasLocal ? item.localVersion : '-'} / {item.hasCloud ? item.cloudVersion : '-'}
                    </td>
                    <td className="py-2.5 px-2 text-center font-mono">
                      {item.hasLocal ? item.localWords : '-'} / {item.hasCloud ? item.cloudWords : '-'}
                    </td>
                    <td className="py-2.5 px-2 text-center whitespace-nowrap">
                      {processedDocs[item.id] ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                            Processed
                          </span>
                          <button
                            onClick={() => handleReadSummary(item.id)}
                            className="p-1 rounded hover:bg-surface-base/10 text-text-main/50 hover:text-text-main transition-colors"
                            title="Прочитать саммари"
                          >
                            <Eye size={12} />
                          </button>
                        </div>
                      ) : processingDocId === item.id ? (
                        <Loader2 size={12} className="animate-spin text-brand-soft mx-auto" />
                      ) : item.hasLocal ? (
                        <button
                          onClick={() => handleProcessDocument(item)}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-brand-soft/10 hover:bg-brand-soft/20 text-brand-soft text-label font-semibold border border-brand-soft/20 transition-colors mx-auto"
                          title="Обработать ИИ"
                        >
                          <Sparkles size={10} />
                          Analyze
                        </button>
                      ) : (
                        <span className="text-[10px] text-text-main/20 font-medium">Needs Local Copy</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {isSyncing ? (
                          <Loader2 size={12} className="animate-spin text-[var(--brand-soft)]" />
                        ) : (
                          <>
                            {item.status === 'local_only' && (
                              <button
                                onClick={() => handleSyncItem(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-label font-semibold border border-blue-500/20 transition-colors"
                                title="Upload to cloud"
                              >
                                <Upload size={10} />
                                Upload
                              </button>
                            )}
                            {item.status === 'cloud_only' && (
                              <button
                                onClick={() => handleDownloadItem(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-green-500/10 hover:bg-green-500/20 text-green-400 text-label font-semibold border border-green-500/20 transition-colors"
                                title="Download to device"
                              >
                                <Download size={10} />
                                Download
                              </button>
                            )}
                            {(item.status === 'pending' || item.status === 'mismatch') && (
                              <button
                                onClick={() => handleSyncItem(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-label font-semibold border border-amber-500/20 transition-colors"
                                title="Sync pending edits to cloud"
                              >
                                <RefreshCw size={10} />
                                Sync
                              </button>
                            )}
                            {item.status === 'cloud_missing' && (
                              <button
                                onClick={() => handleUnlinkItem(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 text-label font-semibold border border-red-500/20 transition-colors"
                                title="Cloud document has been deleted. Unlink local document to allow re-upload."
                              >
                                <Link2Off size={10} />
                                Unlink
                              </button>
                            )}
                            {item.status === 'legacy_session' && (
                              <button
                                onClick={() => handleMigrateLegacySession(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 text-label font-semibold border border-purple-500/20 transition-colors"
                                title="Migrate legacy session to modern document structure"
                              >
                                <RefreshCw size={10} />
                                Migrate
                              </button>
                            )}
                            {hasEncryption && item.hasCloud && item.cloudId && (
                              item.cloudEncrypted ? (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-500/10 text-green-400 text-label font-semibold border border-green-500/20"
                                  title="Already encrypted in cloud"
                                >
                                  <Lock size={10} />
                                  Encrypted
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleEncryptItem(item)}
                                  className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-label font-semibold border border-amber-500/20 transition-colors"
                                  title="Encrypt cloud versions"
                                >
                                  <Lock size={10} />
                                  Encrypt
                                </button>
                              )
                            )}
                            {item.inQueue && (
                              <button
                                onClick={() => handleClearQueueItem(item)}
                                className="p-1 rounded hover:bg-red-500/10 text-text-main/30 hover:text-red-400 transition-colors"
                                title="Remove item from sync queue"
                              >
                                <Trash2 size={10} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {readSummary !== null && (
        <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center" onClick={() => setReadSummary(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-lg mx-4 bg-surface-card border border-border-subtle rounded-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
              <h3 className="text-base font-bold text-text-main flex items-center gap-2">
                <Sparkles size={16} className="text-brand-soft" />
                ИИ Анализ Документа
              </h3>
              <button onClick={() => setReadSummary(null)} className="p-2 rounded-lg text-text-main/40 hover:text-text-main transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-4 overflow-y-auto space-y-4 text-sm text-text-main/80">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-text-main/40">Тональность</span>
                <p className="mt-1 text-sm font-medium text-text-main capitalize">{readSummary.tone}</p>
              </div>

              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-text-main/40">Ключевые слова</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {readSummary.frequentWords.map(word => (
                    <span key={word} className="px-2 py-0.5 text-xs bg-surface-base/10 rounded-md border border-border-subtle text-text-main/70">
                      {word}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-text-main/40">Основные темы</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {readSummary.themes.map(theme => (
                    <span key={theme} className="px-2 py-0.5 text-xs bg-brand-soft/5 rounded-md border border-brand-soft/10 text-brand-soft font-medium">
                      {theme}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-text-main/40">Ключевые мысли и инсайты</span>
                <ul className="mt-2 list-disc list-inside space-y-1.5 pl-1">
                  {readSummary.insights.map((insight, idx) => (
                    <li key={idx} className="text-xs text-text-main/70 leading-relaxed pl-1">
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="px-6 py-3.5 border-t border-border-subtle flex justify-end">
              <button onClick={() => setReadSummary(null)} className="px-4 py-2 rounded-xl bg-text-main text-surface-base text-xs font-medium hover:bg-text-main/90 transition-colors">
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
