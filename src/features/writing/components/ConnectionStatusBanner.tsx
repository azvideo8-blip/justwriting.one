import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WifiOff, Check } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';

interface ConnectionStatusBannerProps {
  showZen?: boolean;
  userId?: string;
  isAuthenticated?: boolean;
}

export function ConnectionStatusBanner({ showZen }: ConnectionStatusBannerProps) {
  const { t } = useLanguage();
  const isOnline = useOnlineStatus();
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
      setTimeout(() => { setWasOffline(true); setShowSynced(false); }, 0);
    }
  }, [isOnline]);

  useEffect(() => {
    if (isOnline && wasOffline) {
      setTimeout(() => setShowSynced(true), 0);
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

      {isOnline && showSynced && (
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
