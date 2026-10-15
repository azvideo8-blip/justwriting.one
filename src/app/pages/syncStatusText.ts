import type { SyncStatusState } from '../../core/sync/useSyncStatus';

/** MF-21 (SA-13): строка «Синхронизация» в профиле. Каждый статус — своя ветка,
 *  без значения по умолчанию: новый статус не скомпилируется, а не напечатает
 *  сырой «{count} заметок ждут…». */
export function syncStatusText(
  s: Pick<SyncStatusState, 'status' | 'pendingCount' | 'unsyncedCount' | 'aiStorePendingCount' | 'aiStoreDeadCount'>,
  t: (key: string, params?: Record<string, string>) => string,
  tp: (key: string, count: number) => string,
): string {
  switch (s.status) {
    case 'synced': return t('synced_compact');
    case 'sync_off': return t('me_status_sync_off');
    case 'offline': return t('sync_paused_no_network');
    case 'cloud_unavailable': return t('sync_paused_cloud_unavailable');
    case 'pending': return tp('sync_pending_notes', s.pendingCount);
    case 'unsynced': return t('sync_paused_unsynced', { count: String(s.unsyncedCount) });
    case 'ai_store_unsynced': return t('sync_ai_store_pending', { count: String(s.aiStorePendingCount + s.aiStoreDeadCount) });
    default: {
      const unreachable: never = s.status;
      return unreachable;
    }
  }
}
