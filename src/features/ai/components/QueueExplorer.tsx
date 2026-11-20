import { useState, useEffect, useCallback } from 'react';
import { LoadNotice } from '../../../shared/components/LoadStateView';
import { Loader2, RefreshCw, Upload, Trash2 } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { useToast } from '../../../shared/components/Toast';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { useLanguage } from '../../../shared/i18n';
import { getLocalDb } from '../../../core/storage/localDb';
import { SyncService } from '../../../core/services/SyncService';
import { reportError } from '../../../shared/errors/reportError';

interface QueueItem {
  id: string;
  documentId: string;
  type: 'document' | 'version' | 'delete' | 'portrait';
  createdAt: number;
  title: string;
}

export function QueueExplorer({ userId }: { userId: string }) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirmDialog();
  const [items, setItems] = useState<QueueItem[]>([]);
  // Не прочиталась очередь ≠ «очередь пуста».
  const [read, setRead] = useState<'loading' | 'error' | 'done'>('loading');
  const loading = read === 'loading';
  const [syncingAll, setSyncingAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [syncingRow, setSyncingRow] = useState<string | null>(null);
  const [removingRow, setRemovingRow] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRead('loading');
    try {
      const db = await getLocalDb();
      const queue = await db.getAll('syncQueue');
      const docs = await db.getAll('documents');
      const docMap = new Map(docs.map(d => [d.id, d.title]));
      const filtered = queue
        .filter(item => !item.id.startsWith('lock_cloud_') && !item.id.startsWith('migrated_'))
        .map(item => ({
          ...item,
          title: docMap.get(item.documentId) ?? t('admin_queue_unknown_note', { id: item.documentId }),
        }));
      setItems(filtered);
      setRead('done');
    } catch (e) {
      reportError(e, { action: 'queue_explorer_refresh' });
      showToast(t('admin_queue_toast_load_error'), 'error');
      setRead('error');
    }
  }, [showToast, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount
  useEffect(() => { void refresh(); }, [refresh]);

  const handleSyncAll = async () => {
    if (!navigator.onLine) {
      showToast(t('admin_queue_toast_offline'), 'error');
      return;
    }
    setSyncingAll(true);
    try {
      const res = await SyncService.syncPending(userId);
      if (res.skippedReason === 'sync_disabled') {
        showToast(t('sync_queue_disabled'), 'error');
      } else if (res.skippedReason === 'in_progress' || res.skippedReason === 'offline' || res.skippedReason === 'vault_locked') {
        // Ничего не ушло — это не «очередь пуста».
        showToast(t(res.skippedReason === 'in_progress' ? 'sync_already_running' : res.skippedReason === 'offline' ? 'admin_queue_toast_offline' : 'settings_sync_vault_locked'), res.skippedReason === 'in_progress' ? 'info' : 'error');
      } else if (res.failed > 0) {
        showToast(t('sync_queue_partial', { drained: String(res.drained), failed: String(res.failed) }), 'error');
      } else if (res.drained === 0) {
        showToast(t('sync_queue_empty'), 'success');
      } else {
        showToast(t('sync_queue_processed', { drained: String(res.drained) }), 'success');
      }
    } catch (e) {
      reportError(e, { action: 'queue_sync_all' });
      showToast(t('admin_queue_toast_sync_error'), 'error');
    } finally {
      setSyncingAll(false);
      void refresh();
    }
  };

  const handleClearQueue = async () => {
    const ok = await confirmDialog({
      title: t('admin_queue_clear_confirm_title'),
      message: t('admin_queue_clear_confirm_message', { count: String(items.length) }),
    });
    if (!ok) return;
    setClearing(true);
    try {
      const db = await getLocalDb();
      const tx = db.transaction('syncQueue', 'readwrite');
      await Promise.all(items.map(item => tx.store.delete(item.id)));
      await tx.done;
      showToast(t('admin_queue_toast_cleared'), 'success');
    } catch (e) {
      reportError(e, { action: 'queue_clear' });
      showToast(t('admin_queue_toast_clear_error'), 'error');
    } finally {
      setClearing(false);
      void refresh();
    }
  };

  const handleSyncItem = async (item: QueueItem) => {
    if (!navigator.onLine) {
      showToast(t('admin_queue_toast_offline'), 'error');
      return;
    }
    setSyncingRow(item.id);
    try {
      const ok = await SyncService.syncDocument(userId, item.documentId);
      if (ok) {
        showToast(t('admin_queue_toast_item_synced'), 'success');
      } else {
        showToast(t('admin_queue_toast_sync_error'), 'error');
      }
    } catch (e) {
      reportError(e, { action: 'queue_sync_item' });
      showToast(t('admin_queue_toast_sync_error'), 'error');
    } finally {
      setSyncingRow(null);
      void refresh();
    }
  };

  const handleRemoveItem = async (item: QueueItem) => {
    setRemovingRow(item.id);
    try {
      const db = await getLocalDb();
      await db.delete('syncQueue', item.id);
    } catch (e) {
      reportError(e, { action: 'queue_remove_item' });
      showToast(t('admin_queue_toast_remove_error'), 'error');
    } finally {
      setRemovingRow(null);
      void refresh();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-text-main">
          {t('admin_queue_title', { count: items.length })}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => void refresh()}
            disabled={loading || syncingAll || clearing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border-subtle bg-surface-base/5 text-text-main/60 text-xs font-semibold disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {t('admin_refresh')}
          </Button>
          <Button
            onClick={() => void handleSyncAll()}
            disabled={loading || syncingAll || clearing || items.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-brand-soft/20 bg-brand-soft/10 text-brand-soft text-xs font-semibold disabled:opacity-50 transition-colors"
          >
            {syncingAll ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {t('admin_queue_sync_all')}
          </Button>
          <Button
            onClick={() => void handleClearQueue()}
            disabled={loading || syncingAll || clearing || items.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-accent-danger/20 bg-accent-danger/10 text-accent-danger text-xs font-semibold disabled:opacity-50 transition-colors"
          >
            {clearing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {t('admin_queue_clear_btn')}
          </Button>
        </div>
      </div>

      {read === 'error' && (
        <LoadNotice variant="row" text={t('admin_queue_toast_load_error')} onRetry={() => void refresh()} />
      )}
      {items.length === 0 && read === 'done' && (
        <p className="text-xs text-text-main/50 py-4 text-center">{t('admin_queue_empty')}</p>
      )}

      {items.length > 0 && (
        <div className="rounded-xl border border-border-subtle overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-base/10 text-text-main/60 text-left">
                <th className="px-3 py-2 font-semibold">{t('admin_queue_th_note')}</th>
                <th className="px-3 py-2 font-semibold">{t('admin_queue_th_type')}</th>
                <th className="px-3 py-2 font-semibold">{t('admin_queue_th_created')}</th>
                <th className="px-3 py-2 font-semibold text-right">{t('admin_queue_th_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-t border-border-subtle hover:bg-surface-base/5">
                  <td className="px-3 py-2">
                    <div className="text-text-main font-medium truncate max-w-[200px]">{item.title}</div>
                    <div className="text-text-main/40 text-[10px]">{item.documentId}</div>
                  </td>
                  <td className="px-3 py-2 text-text-main/60">{item.type}</td>
                  <td className="px-3 py-2 text-text-main/60">
                    {new Date(item.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        onClick={() => void handleSyncItem(item)}
                        disabled={syncingRow === item.id}
                        className="px-2 py-1 rounded-lg border border-border-subtle bg-surface-base/5 text-text-main/60 text-[10px] font-semibold disabled:opacity-50 transition-colors"
                      >
                        {syncingRow === item.id ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                      </Button>
                      <Button
                        onClick={() => void handleRemoveItem(item)}
                        disabled={removingRow === item.id}
                        className="px-2 py-1 rounded-lg border border-border-subtle bg-surface-base/5 text-text-main/60 text-[10px] font-semibold disabled:opacity-50 transition-colors"
                      >
                        {removingRow === item.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
