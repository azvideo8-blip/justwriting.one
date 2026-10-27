import React from 'react';
import { CloudOff, RotateCw } from 'lucide-react';
import { useLanguage } from '../../shared/i18n';
import { useSyncStatus } from '../sync/useSyncStatus';
import { reportError } from '../../shared/errors/reportError';
import { cn } from '../utils/utils';

interface SyncUnsyncedBarProps {
  userId: string | null;
  className?: string;
  /** Рейка в свёрнутом виде: строка не помещается — остаётся только значок. */
  compact?: boolean;
}

/**
 * RA1-4: на главном не было видно, что заметка не ушла в облако, — человек
 * узнавал об этом, только зайдя в профиль. Одна строка на все места:
 * «Не синхронизировано: N · Повторить».
 */
export function SyncUnsyncedBar({ userId, className, compact = false }: SyncUnsyncedBarProps) {
  const { t } = useLanguage();
  const { status, unsyncedCount, autoSyncEnabled } = useSyncStatus(userId);
  const [retrying, setRetrying] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  // Дейлик 27.10 Н-2: движок отказался отправлять (сейф заперт / нет сети) —
  // строка называет причину, а не обещает повтор, который ничего не сделал.
  const [skipped, setSkipped] = React.useState<'vault_locked' | 'offline' | null>(null);

  // BR-2: полоса и её «Повторить» — только тем, кто синхронизацию включил.
  // Очередь пополняется при любом тумблере, и кнопка с невинной подписью
  // выгружала в облако заметки человека, выбравшего «только на устройстве».
  if (!userId || unsyncedCount <= 0 || !autoSyncEnabled) return null;

  const retry = async () => {
    setRetrying(true);
    setFailed(false);
    setSkipped(null);
    try {
      // N-2: движок синка — по требованию. Статическое ребро из рейки тянуло
      // SyncService и весь облачный слой в стартовый кусок (гейт bootChunkGraph).
      // BR-2: без `force` — синхронизация включена, обычной очереди достаточно.
      const { SyncService } = await import('../services/SyncService');
      const res = await SyncService.syncPending(userId);
      // «Готово» здесь не звучит никогда: строка уходит сама, когда счётчик
      // станет нулём, а частичный провал — это провал.
      if (res.failed > 0) setFailed(true);
      else if (res.skippedReason === 'vault_locked' || res.skippedReason === 'offline') setSkipped(res.skippedReason);
    } catch (e) {
      reportError(e, { action: 'syncUnsyncedBar/retry', userId });
      setFailed(true);
    } finally {
      setRetrying(false);
    }
  };

  const label = failed
    ? t('sync_retry_failed')
    : skipped === 'vault_locked'
      ? t('vault_locked_banner_compact')
      : status === 'offline' || skipped === 'offline'
      ? t('sync_paused_no_network')
      : t('sync_unsynced_compact', { count: unsyncedCount });

  return (
    <div
      data-testid="sync-unsynced-bar"
      data-compact={compact ? 'true' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-card/90 px-3 py-1 text-[13px] leading-snug',
        failed ? 'text-[var(--accent-danger)]' : 'text-[var(--accent-warning)]',
        className ?? 'justify-between'
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <CloudOff size={14} className="shrink-0" aria-hidden="true" />
        <span role="status" className="truncate">{label}</span>
      </span>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={retrying}
        className="press inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 font-medium text-text-main/80 hover:text-text-main disabled:opacity-50"
      >
        <RotateCw size={13} aria-hidden="true" className={retrying ? 'animate-spin' : undefined} />
        {t('sync_retry')}
      </button>
    </div>
  );
}
