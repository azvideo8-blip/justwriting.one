import { useState, useMemo } from 'react';
import { RefreshCw, AlertTriangle, Upload, Download, Trash2, Loader2, Link2Off, Lock, Sparkles, Eye } from 'lucide-react';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { cn } from '../../../core/utils/utils';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useSyncDiagnostics, type DiagnosticItem } from '../hooks/useSyncDiagnostics';
import { SummaryModal } from './SummaryModal';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';

interface SyncDiagnosticsProps {
  userId: string;
}

export function SyncDiagnostics({ userId }: SyncDiagnosticsProps) {
  const { layoutMode } = useLayoutMode();
  const {
    loading, syncingId, items, queueCount,
    processedDocs, processingDocId, readSummary, setReadSummary,
    hasEncryption,
    fetchData, handleSyncItem, handleDownloadItem, handleUnlinkItem,
    handleEncryptItem, handleClearQueueItem, handleSyncAllQueue,
    handleProcessDocument, handleReadSummary,
    getStatusBadge,
  } = useSyncDiagnostics({ userId });

  type SortKey = 'title' | 'date' | 'status' | 'versions' | 'words' | 'ai';
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'title' ? 'asc' : 'desc');
    }
  };
  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  const displayItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? items.filter(i => i.title.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
      : items;
    const val = (i: DiagnosticItem): string | number => {
      switch (sortKey) {
        case 'title': return i.title.toLowerCase();
        case 'date': return i.date ?? 0;
        case 'status': return i.status;
        case 'versions': return i.localVersion ?? i.cloudVersion ?? 0;
        case 'words': return i.localWords ?? i.cloudWords ?? 0;
        case 'ai': return processedDocs[i.id] ? 1 : 0;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b);
      const cmp = typeof va === 'string' && typeof vb === 'string'
        ? va.localeCompare(vb)
        : (va as number) - (vb as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [items, search, sortKey, sortDir, processedDocs]);

  const formatDate = (ms?: number) =>
    ms ? new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

  return (
    <div className="space-y-4 p-4 rounded-xl border border-border-subtle bg-surface-card/30">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-text-main/60">
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
            <Button
              onClick={() => void handleSyncAllQueue()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition-colors"
            >
              Sync Queue ({queueCount})
            </Button>
          )}
          <IconButton
            onClick={() => void fetchData()}
            disabled={loading}
            className="p-1.5 rounded-lg border border-border-subtle hover:bg-surface-base/10 text-text-main/60 hover:text-text-main transition-colors"
            label="Refresh diagnostics"
            icon={<RefreshCw size={14} className={cn(loading && "animate-spin")} />}
          />
        </div>
      </div>

      {items.length > 0 && (
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по названию…"
          className="w-full px-3 py-2 rounded-lg bg-surface-base/5 border border-border-subtle text-xs text-text-main placeholder:text-text-main/40 outline-none focus:border-brand-soft/40"
        />
      )}

      {loading && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <Loader2 size={24} className="animate-spin text-text-main/60" />
          <span className="text-xs text-text-main/60">Analyzing database differences...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-6 text-xs text-text-main/60">
          No documents found on this device or in the cloud.
        </div>
      ) : layoutMode === 'mobile' ? (
        <div className="space-y-3">
          {displayItems.map(item => {
            const isSyncing = syncingId === item.id;
            return (
              <div key={item.id} className="p-3 rounded-lg border border-border-subtle bg-surface-base/5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-text-main text-sm truncate" title={item.title}>
                      {item.title}
                    </h4>
                    <span className="text-label text-text-main/60 font-mono block truncate mt-0.5">{item.id}</span>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {getStatusBadge(item.status)}
                    <span className="text-label text-text-main/60 font-mono whitespace-nowrap">{formatDate(item.date)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-label-sm text-text-main/60 bg-surface-card/20 p-2 rounded">
                  <div>
                    <span className="text-text-main/60 block">Versions (L / C)</span>
                    <span className="font-mono text-text-main">
                      {item.hasLocal ? item.localVersion : '-'} / {item.hasCloud ? item.cloudVersion : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-main/60 block">Words (L / C)</span>
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
                        <Button
                          onClick={() => void handleSyncItem(item)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-semibold border border-blue-500/20 transition-colors min-h-[44px]"
                        >
                          <Upload size={14} />
                          Upload
                        </Button>
                      )}
                      {item.status === 'cloud_only' && (
                        <Button
                          onClick={() => void handleDownloadItem(item)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 text-xs font-semibold border border-green-500/20 transition-colors min-h-[44px]"
                        >
                          <Download size={14} />
                          Download
                        </Button>
                      )}
                      {(item.status === 'pending' || item.status === 'mismatch') && (
                        <Button
                          onClick={() => void handleSyncItem(item)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-semibold border border-amber-500/20 transition-colors min-h-[44px]"
                        >
                          <RefreshCw size={14} />
                          Sync
                        </Button>
                      )}
                      {item.status === 'cloud_missing' && (
                        <Button
                          onClick={() => void handleUnlinkItem(item)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent-danger/10 hover:bg-accent-danger/20 text-accent-danger text-xs font-semibold border border-accent-danger/20 transition-colors min-h-[44px]"
                        >
                          <Link2Off size={14} />
                          Unlink
                        </Button>
                      )}
                      {hasEncryption && item.hasCloud && item.cloudId && (
                        item.cloudEncrypted ? (
                          <span className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/10 text-green-400 text-xs font-semibold border border-green-500/20 min-h-[44px]">
                            <Lock size={14} />
                            Encrypted
                          </span>
                        ) : (
                          <Button
                            onClick={() => void handleEncryptItem(item)}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-semibold border border-amber-500/20 transition-colors min-h-[44px]"
                          >
                            <Lock size={14} />
                            Encrypt
                          </Button>
                        )
                      )}
                      {item.inQueue && (
                        <IconButton
                          onClick={() => void handleClearQueueItem(item)}
                          className="px-3 py-2 rounded-lg bg-accent-danger/10 hover:bg-accent-danger/20 text-accent-danger border border-accent-danger/20 transition-colors min-h-[44px]"
                          label="Remove item from sync queue"
                          icon={<Trash2 size={14} />}
                        />
                      )}
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-border-subtle/50 pt-2 text-label-sm">
                  <span className="text-text-main/60 font-medium">AI Analysis</span>
                  <div>
                    {processedDocs[item.id] ? (
                      <div className="flex items-center gap-2">
                        <span className="text-green-400 font-medium">Processed</span>
                        <Button
                          onClick={() => void handleReadSummary(item.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-card border border-border-subtle text-text-main/70 text-xs font-medium"
                        >
                          <Eye size={14} />
                          Read Summary
                        </Button>
                      </div>
                    ) : processingDocId === item.id ? (
                      <div className="flex items-center gap-1.5 text-text-main/60">
                        <Loader2 size={14} className="animate-spin text-brand-soft" />
                        Processing...
                      </div>
                    ) : item.hasLocal ? (
                      <Button
                        onClick={() => void handleProcessDocument(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-soft/10 border border-brand-soft/20 text-brand-soft text-xs font-semibold"
                      >
                        <Sparkles size={14} />
                        Analyze with AI
                      </Button>
                    ) : (
                      <span className="text-text-main/60 text-xs">Needs Local Copy</span>
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
              <tr className="border-b border-border-subtle text-text-main/60 font-medium">
                <th className="py-2 px-3"><button type="button" onClick={() => toggleSort('title')} className="hover:text-text-main transition-colors">Note Title{sortArrow('title')}</button></th>
                <th className="py-2 px-2 text-center"><button type="button" onClick={() => toggleSort('date')} className="hover:text-text-main transition-colors">Date{sortArrow('date')}</button></th>
                <th className="py-2 px-2 text-center"><button type="button" onClick={() => toggleSort('status')} className="hover:text-text-main transition-colors">Location{sortArrow('status')}</button></th>
                <th className="py-2 px-2 text-center"><button type="button" onClick={() => toggleSort('versions')} className="hover:text-text-main transition-colors">Versions (L/C){sortArrow('versions')}</button></th>
                <th className="py-2 px-2 text-center"><button type="button" onClick={() => toggleSort('words')} className="hover:text-text-main transition-colors">Words (L/C){sortArrow('words')}</button></th>
                <th className="py-2 px-2 text-center"><button type="button" onClick={() => toggleSort('ai')} className="hover:text-text-main transition-colors">AI{sortArrow('ai')}</button></th>
                <th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map(item => {
                const isSyncing = syncingId === item.id;
                return (
                  <tr key={item.id} className="border-b border-border-subtle/50 hover:bg-surface-base/5 text-text-main/80">
                    <td className="py-2.5 px-3 max-w-[150px] truncate" title={item.title}>
                      <span className="font-medium text-text-main">{item.title}</span>
                      <div className="text-[9px] text-text-main/60 font-mono truncate">{item.id}</div>
                    </td>
                    <td className="py-2.5 px-2 text-center whitespace-nowrap font-mono text-[11px] text-text-main/60">
                      {formatDate(item.date)}
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
                          <IconButton
                            onClick={() => void handleReadSummary(item.id)}
                            className="p-1 rounded hover:bg-surface-base/10 text-text-main/60 hover:text-text-main transition-colors"
                            label="Прочитать саммари"
                            icon={<Eye size={12} />}
                          />
                        </div>
                      ) : processingDocId === item.id ? (
                        <Loader2 size={12} className="animate-spin text-brand-soft mx-auto" />
                      ) : item.hasLocal ? (
                        <Button
                          onClick={() => void handleProcessDocument(item)}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-brand-soft/10 hover:bg-brand-soft/20 text-brand-soft text-label font-semibold border border-brand-soft/20 transition-colors mx-auto"
                          title="Обработать ИИ"
                        >
                          <Sparkles size={10} />
                          Analyze
                        </Button>
                      ) : (
                        <span className="text-[10px] text-text-main/60 font-medium">Needs Local Copy</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {isSyncing ? (
                          <Loader2 size={12} className="animate-spin text-[var(--brand-soft)]" />
                        ) : (
                          <>
                            {item.status === 'local_only' && (
                              <Button
                                onClick={() => void handleSyncItem(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-label font-semibold border border-blue-500/20 transition-colors"
                                title="Upload to cloud"
                              >
                                <Upload size={10} />
                                Upload
                              </Button>
                            )}
                            {item.status === 'cloud_only' && (
                              <Button
                                onClick={() => void handleDownloadItem(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-green-500/10 hover:bg-green-500/20 text-green-400 text-label font-semibold border border-green-500/20 transition-colors"
                                title="Download to device"
                              >
                                <Download size={10} />
                                Download
                              </Button>
                            )}
                            {(item.status === 'pending' || item.status === 'mismatch') && (
                              <Button
                                onClick={() => void handleSyncItem(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-label font-semibold border border-amber-500/20 transition-colors"
                                title="Sync pending edits to cloud"
                              >
                                <RefreshCw size={10} />
                                Sync
                              </Button>
                            )}
                            {item.status === 'cloud_missing' && (
                              <Button
                                onClick={() => void handleUnlinkItem(item)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-accent-danger/10 hover:bg-accent-danger/20 text-accent-danger text-label font-semibold border border-accent-danger/20 transition-colors"
                                title="Cloud document has been deleted. Unlink local document to allow re-upload."
                              >
                                <Link2Off size={10} />
                                Unlink
                              </Button>
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
                                <Button
                                  onClick={() => void handleEncryptItem(item)}
                                  className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-label font-semibold border border-amber-500/20 transition-colors"
                                  title="Encrypt cloud versions"
                                >
                                  <Lock size={10} />
                                  Encrypt
                                </Button>
                              )
                            )}
                            {item.inQueue && (
                              <IconButton
                                onClick={() => void handleClearQueueItem(item)}
                                className="p-1 rounded hover:bg-accent-danger/10 text-text-main/60 hover:text-accent-danger transition-colors"
                                label="Remove item from sync queue"
                                icon={<Trash2 size={10} />}
                              />
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

      <SummaryModal summary={readSummary} onClose={() => setReadSummary(null)} />
    </div>
  );
}
