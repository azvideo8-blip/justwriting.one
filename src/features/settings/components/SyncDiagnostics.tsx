import React, { useState, useEffect, useCallback } from 'react';
import { Cloud, HardDrive, RefreshCw, AlertTriangle, CheckCircle2, Upload, Download, Trash2, Loader2, Link2Off, Lock } from 'lucide-react';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { DocumentService } from '../../writing/services/DocumentService';
import { SyncService } from '../../writing/services/SyncService';
import { StorageService } from '../../writing/services/StorageService';
import { SessionService } from '../../writing/services/SessionService';
import { getLocalDb } from '../../../shared/lib/localDb';
import { useLanguage } from '../../../core/i18n';
import { useToast } from '../../../shared/components/Toast';
import { useAuthStatus } from '../../auth/contexts/AuthContext';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { cn } from '../../../core/utils/utils';
import { encryptSingleDocument } from '../../../core/crypto/encryptMigration';
import { maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { Session } from '../../../types';

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
}

export function SyncDiagnostics({ userId }: SyncDiagnosticsProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { profile } = useAuthStatus();
  const hasEncryption = !!(profile?.encryptionSalt && profile?.encryptedDataKey);

  const [loading, setLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [items, setItems] = useState<DiagnosticItem[]>([]);
  const [queueCount, setQueueCount] = useState(0);

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

      setItems(Array.from(itemsMap.values()).sort((a, b) => b.title.localeCompare(a.title)));
    } catch (e) {
      console.error('[SyncDiagnostics] Error fetching diagnostics:', e);
      showToast(t('error_generic_action') || 'Error fetching status', 'error');
    } finally {
      setLoading(false);
    }
  }, [userId, t, showToast]);

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

  const getStatusBadge = (status: DiagnosticItem['status']) => {
    switch (status) {
      case 'synced':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">
            <CheckCircle2 size={10} />
            Synced
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
            <AlertTriangle size={10} />
            Pending Sync
          </span>
        );
      case 'mismatch':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle size={10} />
            Unsynced Edits
          </span>
        );
      case 'local_only':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-500/10 text-gray-400 border border-gray-500/20">
            <HardDrive size={10} />
            Device Only
          </span>
        );
      case 'cloud_only':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Cloud size={10} />
            Cloud Only
          </span>
        );
      case 'cloud_missing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
            <AlertTriangle size={10} />
            Cloud Copy Lost
          </span>
        );
      case 'legacy_session':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
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
            <div className="text-[11px] text-amber-500/80 mt-1 font-medium flex items-center gap-1">
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition-all"
            >
              Sync Queue ({queueCount})
            </button>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-1.5 rounded-lg border border-border-subtle hover:bg-surface-base/10 text-text-main/60 hover:text-text-main transition-all disabled:opacity-50"
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
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border-subtle text-text-main/40 font-medium">
                <th className="py-2 px-3">Note Title</th>
                <th className="py-2 px-2 text-center">Location</th>
                <th className="py-2 px-2 text-center">Versions (L/C)</th>
                <th className="py-2 px-2 text-center">Words (L/C)</th>
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
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {isSyncing ? (
                          <Loader2 size={12} className="animate-spin text-[var(--brand-soft)]" />
                        ) : (
                          <>
                            {item.status === 'local_only' && (
                              <button
                                onClick={() => handleSyncItem(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[10px] font-semibold border border-blue-500/20 transition-all"
                                title="Upload to cloud"
                              >
                                <Upload size={10} />
                                Upload
                              </button>
                            )}
                            {item.status === 'cloud_only' && (
                              <button
                                onClick={() => handleDownloadItem(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-green-500/10 hover:bg-green-500/20 text-green-400 text-[10px] font-semibold border border-green-500/20 transition-all"
                                title="Download to device"
                              >
                                <Download size={10} />
                                Download
                              </button>
                            )}
                            {(item.status === 'pending' || item.status === 'mismatch') && (
                              <button
                                onClick={() => handleSyncItem(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[10px] font-semibold border border-amber-500/20 transition-all"
                                title="Sync pending edits to cloud"
                              >
                                <RefreshCw size={10} />
                                Sync
                              </button>
                            )}
                            {item.status === 'cloud_missing' && (
                              <button
                                onClick={() => handleUnlinkItem(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] font-semibold border border-red-500/20 transition-all"
                                title="Cloud document has been deleted. Unlink local document to allow re-upload."
                              >
                                <Link2Off size={10} />
                                Unlink
                              </button>
                            )}
                            {item.status === 'legacy_session' && (
                              <button
                                onClick={() => handleMigrateLegacySession(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 text-[10px] font-semibold border border-purple-500/20 transition-all"
                                title="Migrate legacy session to modern document structure"
                              >
                                <RefreshCw size={10} />
                                Migrate
                              </button>
                            )}
                            {hasEncryption && item.hasCloud && item.cloudId && (
                              <button
                                onClick={() => handleEncryptItem(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[10px] font-semibold border border-amber-500/20 transition-all"
                                title="Encrypt cloud versions"
                              >
                                <Lock size={10} />
                                Encrypt
                              </button>
                            )}
                            {item.inQueue && (
                              <button
                                onClick={() => handleClearQueueItem(item)}
                                className="p-1 rounded hover:bg-red-500/10 text-text-main/30 hover:text-red-400 transition-all"
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
    </div>
  );
}
