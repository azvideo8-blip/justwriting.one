import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WifiOff, Cloud, HardDrive, Check } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { SyncService } from '../services/SyncService';

interface ConnectionStatusBannerProps {
  showZen?: boolean;
  userId?: string;
}

export function ConnectionStatusBanner({ showZen, userId }: ConnectionStatusBannerProps) {
  const { t } = useLanguage();
  const isOnline = useOnlineStatus();
  const { autoSync } = useWritingSettings();
  const { isAuthenticated } = useAuthStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const [showSynced, setShowSynced] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
      setShowSynced(false);
    }
  }, [isOnline]);

  useEffect(() => {
    if (isOnline && userId) {
      Promise.all([
        SyncService.getPendingCount(),
        SyncService.getUnsyncedCount(userId),
      ]).then(([queueCount, unsyncedCount]) => {
        setPendingCount(queueCount + unsyncedCount);
      });
    }
  }, [isOnline, userId]);

  useEffect(() => {
    if (isOnline && pendingCount > 0 && !syncing && userId && autoSync && isAuthenticated) {
      setSyncing(true);
      SyncService.syncAllUnlinked(userId).finally(() => {
        setSyncing(false);
        setPendingCount(0);
        setShowSynced(true);
        setTimeout(() => setShowSynced(false), 3000);
      });
    }
  }, [isOnline, pendingCount, syncing, userId, autoSync, isAuthenticated]);

  useEffect(() => {
    if (isOnline && wasOffline && pendingCount === 0 && !syncing) {
      setShowSynced(true);
      const timer = setTimeout(() => setShowSynced(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline, pendingCount, syncing]);

  if (showZen) return null;

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          key="offline"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={cn(
            "fixed top-4 left-1/2 -translate-x-1/2 z-[60]",
            "flex items-center gap-2 px-4 py-2 rounded-2xl",
            "bg-amber-500/10 border border-amber-500/30 backdrop-blur-xl",
            "text-amber-400 text-sm font-medium whitespace-nowrap"
          )}
        >
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
          <WifiOff size={16} className="shrink-0" />
          <span>{t('offline_working_locally')}</span>
        </motion.div>
      )}

      {isOnline && syncing && (
        <motion.div
          key="syncing"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={cn(
            "fixed top-4 left-1/2 -translate-x-1/2 z-[60]",
            "flex items-center gap-2 px-4 py-2 rounded-2xl",
            "bg-blue-500/10 border border-blue-500/30 backdrop-blur-xl",
            "text-blue-400 text-sm font-medium whitespace-nowrap"
          )}
        >
          <HardDrive size={16} className="shrink-0 animate-pulse" />
          <span>{t('offline_syncing')}</span>
        </motion.div>
      )}

      {isOnline && !syncing && pendingCount > 0 && autoSync && isAuthenticated && (
        <motion.div
          key="pending"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={cn(
            "fixed top-4 left-1/2 -translate-x-1/2 z-[60]",
            "flex items-center gap-2 px-4 py-2 rounded-2xl",
            "bg-blue-500/10 border border-blue-500/30 backdrop-blur-xl",
            "text-blue-400 text-sm font-medium whitespace-nowrap"
          )}
        >
          <Cloud size={16} className="shrink-0" />
          <span>{t('offline_pending', { count: pendingCount })}</span>
        </motion.div>
      )}

      {isOnline && showSynced && pendingCount === 0 && !syncing && (
        <motion.div
          key="synced"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={cn(
            "fixed top-4 left-1/2 -translate-x-1/2 z-[60]",
            "flex items-center gap-2 px-4 py-2 rounded-2xl",
            "bg-emerald-500/10 border border-emerald-500/30 backdrop-blur-xl",
            "text-emerald-400 text-sm font-medium whitespace-nowrap"
          )}
        >
          <Check size={16} className="shrink-0" />
          <span>{t('offline_synced')}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
