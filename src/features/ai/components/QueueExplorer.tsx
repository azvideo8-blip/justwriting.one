import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, Upload, Trash2 } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { useToast } from '../../../shared/components/Toast';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
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
  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirmDialog();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingAll, setSyncingAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [syncingRow, setSyncingRow] = useState<string | null>(null);
  const [removingRow, setRemovingRow] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getLocalDb();
      const queue = await db.getAll('syncQueue');
      const docs = await db.getAll('documents');
      const docMap = new Map(docs.map(d => [d.id, d.title]));
      const filtered = queue
        .filter(item => !item.id.startsWith('lock_cloud_') && !item.id.startsWith('migrated_'))
        .map(item => ({
          ...item,
          title: docMap.get(item.documentId) ?? `Неизвестная заметка (${item.documentId})`,
        }));
      setItems(filtered);
    } catch (e) {
      reportError(e, { action: 'queue_explorer_refresh' });
      showToast('Не удалось загрузить очередь', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleSyncAll = async () => {
    if (!navigator.onLine) {
      showToast('Данная функция работает только при подключении к сети', 'error');
      return;
    }
    setSyncingAll(true);
    try {
      await SyncService.syncPending(userId);
      showToast('Синхронизация завершена', 'success');
    } catch (e) {
      reportError(e, { action: 'queue_sync_all' });
      showToast('Ошибка синхронизации', 'error');
    } finally {
      setSyncingAll(false);
      void refresh();
    }
  };

  const handleClearQueue = async () => {
    const ok = await confirmDialog({
      title: 'Очистить очередь?',
      message: `Удалить все ${items.length} элементов из очереди? Отложенные облачные синхронизации будут безвозвратно отменены.`,
    });
    if (!ok) return;
    setClearing(true);
    try {
      const db = await getLocalDb();
      const tx = db.transaction('syncQueue', 'readwrite');
      await Promise.all(items.map(item => tx.store.delete(item.id)));
      await tx.done;
      showToast('Очередь очищена', 'success');
    } catch (e) {
      reportError(e, { action: 'queue_clear' });
      showToast('Не удалось очистить очередь', 'error');
    } finally {
      setClearing(false);
      void refresh();
    }
  };

  const handleSyncItem = async (item: QueueItem) => {
    if (!navigator.onLine) {
      showToast('Данная функция работает только при подключении к сети', 'error');
      return;
    }
    setSyncingRow(item.id);
    try {
      await SyncService.syncDocument(userId, item.documentId);
      showToast('Заметка синхронизирована', 'success');
    } catch (e) {
      reportError(e, { action: 'queue_sync_item' });
      showToast('Ошибка синхронизации', 'error');
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
      showToast('Не удалось удалить элемент', 'error');
    } finally {
      setRemovingRow(null);
      void refresh();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-text-main">
          Очередь синхронизации ({items.length})
        </h3>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => void refresh()}
            disabled={loading || syncingAll || clearing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border-subtle bg-surface-base/5 text-text-main/60 text-xs font-semibold disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Обновить
          </Button>
          <Button
            onClick={() => void handleSyncAll()}
            disabled={loading || syncingAll || clearing || items.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-brand-soft/20 bg-brand-soft/10 text-brand-soft text-xs font-semibold disabled:opacity-50 transition-colors"
          >
            {syncingAll ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Синхронизировать все
          </Button>
          <Button
            onClick={() => void handleClearQueue()}
            disabled={loading || syncingAll || clearing || items.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-accent-danger/20 bg-accent-danger/10 text-accent-danger text-xs font-semibold disabled:opacity-50 transition-colors"
          >
            {clearing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Очистить очередь
          </Button>
        </div>
      </div>

      {items.length === 0 && !loading && (
        <p className="text-xs text-text-main/50 py-4 text-center">Очередь пуста</p>
      )}

      {items.length > 0 && (
        <div className="rounded-xl border border-border-subtle overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-base/10 text-text-main/60 text-left">
                <th className="px-3 py-2 font-semibold">Заметка</th>
                <th className="px-3 py-2 font-semibold">Тип</th>
                <th className="px-3 py-2 font-semibold">Создано</th>
                <th className="px-3 py-2 font-semibold text-right">Действия</th>
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
