import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WifiOff, Check } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useSyncStatus } from '../../../core/sync/useSyncStatus';
import { useAuthStatus } from '../../../app/useAuthStatus';

interface ConnectionStatusBannerProps {
  showZen?: boolean;
}

export function ConnectionStatusBanner({ showZen }: ConnectionStatusBannerProps) {
  const { t } = useLanguage();
  const { user, isGuest } = useAuthStatus();
  const isOnline = useOnlineStatus();
  const syncStatus = useSyncStatus(isGuest ? null : (user?.uid ?? null));
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode !== 'desktop';
  const prevOnlineRef = useRef(isOnline);
  const [showSynced, setShowSynced] = useState(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (isOnline && !prevOnlineRef.current) {
      setShowSynced(true);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => setShowSynced(false), 3000);
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline]);

  const isSynced = syncStatus.status === 'synced';
  const reconnectedText = isSynced
    ? (isMobile ? t('synced_compact') : t('offline_synced'))
    : (isMobile ? t('connection_restored_compact') : t('connection_restored'));

  // Show offline indicator even in zen mode — users need to know sync is down
  if (showZen && isOnline) return null;

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          key="offline"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={cn(
            "fixed left-1/2 -translate-x-1/2 z-[var(--z-overlay)] top-[calc(env(safe-area-inset-top,0px)+12px)]",
            "flex items-center gap-2 backdrop-blur-xl border font-medium whitespace-nowrap",
            isMobile
              ? "px-3 py-1.5 rounded-xl text-xs bg-accent-warning/15 border-accent-warning/30 text-accent-warning"
              : "px-4 py-2 rounded-2xl text-sm bg-accent-warning/15 border-accent-warning/30 text-accent-warning"
          )}
        >
          <div className="w-2 h-2 rounded-full bg-accent-warning animate-pulse shrink-0" />
          <WifiOff size={16} className="shrink-0" />
          <span>{isMobile ? t('offline_compact') : t('offline_working_locally')}</span>
        </motion.div>
      )}

      {isOnline && showSynced && (
        <motion.div
          key="synced"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={cn(
            "fixed left-1/2 -translate-x-1/2 z-[var(--z-overlay)] top-[calc(env(safe-area-inset-top,0px)+12px)]",
            "flex items-center gap-2 backdrop-blur-xl border font-medium whitespace-nowrap",
            isMobile
              ? "px-3 py-1.5 rounded-xl text-xs bg-accent-success/15 border-accent-success/30 text-accent-success"
              : "px-4 py-2 rounded-2xl text-sm bg-accent-success/15 border-accent-success/30 text-accent-success"
          )}
        >
          <Check size={16} className="shrink-0" />
          <span>{reconnectedText}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
