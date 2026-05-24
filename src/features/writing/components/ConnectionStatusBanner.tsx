import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WifiOff, Check } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';

interface ConnectionStatusBannerProps {
  showZen?: boolean;
}

export function ConnectionStatusBanner({ showZen }: ConnectionStatusBannerProps) {
  const { t } = useLanguage();
  const isOnline = useOnlineStatus();
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode !== 'desktop';
  const [wasOffline, setWasOffline] = useState(false);
  const [showSynced, setShowSynced] = useState(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOnline) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWasOffline(true);
      setShowSynced(false);
    }
  }, [isOnline]);

  useEffect(() => {
    if (isOnline && wasOffline) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowSynced(true);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => setShowSynced(false), 3000);
    }
  }, [isOnline, wasOffline]);

  if (showZen) return null;

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          key="offline"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
          className={cn(
            "fixed left-1/2 -translate-x-1/2 z-[60]",
            "flex items-center gap-2 backdrop-blur-xl border font-medium whitespace-nowrap",
            isMobile
              ? "px-3 py-1.5 rounded-xl text-xs bg-amber-500/15 border-amber-500/30 text-amber-400"
              : "px-4 py-2 rounded-2xl text-sm bg-amber-500/10 border-amber-500/30 text-amber-400"
          )}
        >
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
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
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
          className={cn(
            "fixed left-1/2 -translate-x-1/2 z-[60]",
            "flex items-center gap-2 backdrop-blur-xl border font-medium whitespace-nowrap",
            isMobile
              ? "px-3 py-1.5 rounded-xl text-xs bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
              : "px-4 py-2 rounded-2xl text-sm bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
          )}
        >
          <Check size={16} className="shrink-0" />
          <span>{isMobile ? t('synced_compact') : t('offline_synced')}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
