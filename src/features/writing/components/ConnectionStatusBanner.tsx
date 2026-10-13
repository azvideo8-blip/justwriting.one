import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WifiOff, Check, Lock } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useSyncStatus } from '../../../core/sync/useSyncStatus';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useAuth } from '../../auth/contexts/AuthContext';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';

interface ConnectionStatusBannerProps {
  showZen?: boolean;
}

export function ConnectionStatusBanner({ showZen }: ConnectionStatusBannerProps) {
  const { t } = useLanguage();
  const { user, isGuest } = useAuthStatus();
  // Браузер «в сети», а сервер не ответил на восстановление входа — так
  // выглядит, например, VPN, который не пропускает до нашего сервера.
  const { serverUnreachable } = useAuth();
  const isOnline = useOnlineStatus();
  const syncStatus = useSyncStatus(isGuest ? null : (user?.uid ?? null));
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode !== 'desktop';
  const prevOnlineRef = useRef(isOnline);
  const [showSynced, setShowSynced] = useState(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // F-1: сейф включён и заперт — всё, что шифруется, ждёт ключа. Человек
  // должен видеть это состоянием, а не потоком красного в журнале.
  const uid = isGuest ? null : (user?.uid ?? null);
  const isVaultUnlocked = useEncryptionStore(s => s.isVaultUnlocked);
  const encryptionEnabled = useEncryptionStore(s => (uid ? s.encryptionEnabled[uid] : undefined));
  useEffect(() => {
    // Флаг лениво поднимается из localStorage — до первого чтения в сторе его нет.
    if (uid) useEncryptionStore.getState().getEncryptionEnabled(uid);
  }, [uid]);
  const vaultLocked = Boolean(uid) && encryptionEnabled === true && !isVaultUnlocked;

  // MB-8 (F-8): на телефоне баннер встаёт в поток над содержимым, а не лежит
  // fixed поверх заголовков страниц и шапки чата. Сам баннер остаётся — это
  // честное состояние, а не украшение.
  const BANNER_POSITION = isMobile
    ? 'relative z-[var(--z-overlay)] mx-auto mt-[calc(env(safe-area-inset-top,0px)+12px)]'
    : 'fixed left-1/2 -translate-x-1/2 z-[var(--z-overlay)] top-[calc(env(safe-area-inset-top,0px)+12px)]';

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
  if (showZen && isOnline && !serverUnreachable) return null;

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          key="offline"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={cn(
            BANNER_POSITION,
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

      {isOnline && serverUnreachable && (
        <motion.div
          key="unreachable"
          role="status"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={cn(
            BANNER_POSITION,
            "flex items-center gap-2 backdrop-blur-xl border font-medium",
            isMobile
              ? "px-3 py-1.5 rounded-xl text-xs bg-accent-warning/15 border-accent-warning/30 text-accent-warning max-w-[calc(100vw-32px)]"
              : "px-4 py-2 rounded-2xl text-sm bg-accent-warning/15 border-accent-warning/30 text-accent-warning"
          )}
        >
          <WifiOff size={16} className="shrink-0" />
          <span>{t('server_unreachable_vpn')}</span>
        </motion.div>
      )}

      {isOnline && !serverUnreachable && !showSynced && vaultLocked && (
        <motion.div
          key="vault-locked"
          role="status"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={cn(
            BANNER_POSITION,
            "flex items-center gap-2 backdrop-blur-xl border font-medium",
            isMobile
              ? "px-3 py-1.5 rounded-xl text-xs bg-accent-warning/15 border-accent-warning/30 text-accent-warning max-w-[calc(100vw-32px)]"
              : "px-4 py-2 rounded-2xl text-sm bg-accent-warning/15 border-accent-warning/30 text-accent-warning"
          )}
        >
          <Lock size={16} className="shrink-0" />
          <span>{isMobile ? t('vault_locked_banner_compact') : t('vault_locked_banner')}</span>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('open-vault-unlock'))}
            className={cn(
              "shrink-0 underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-warning/50 rounded",
              // Цель касания не 16 px высотой (F-8: «Открыть сейф» была 84×16).
              isMobile && "min-h-[44px] px-3 py-2"
            )}
          >
            {t('vault_locked_open')}
          </button>
        </motion.div>
      )}

      {isOnline && showSynced && (
        <motion.div
          key="synced"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={cn(
            BANNER_POSITION,
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
