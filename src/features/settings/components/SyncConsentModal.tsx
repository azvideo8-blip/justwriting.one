import React, { useState, useEffect } from "react";
import { Cloud } from "lucide-react";
import { Button } from "../../../shared/components/Button";
import { ModalShell } from "../../../shared/components/ModalShell";
import { useLanguage } from "../../../shared/i18n";
import { useAuthStatus } from "../../../features/auth/hooks/useAuthStatus";
import { STORAGE_KEYS } from "../../../shared/constants/storageKeys";
import { SyncService } from "../../../core/services/SyncService";
import { setCloudSyncEnabled } from "../../../core/sync/cloudSyncEnabled";

interface SyncConsentModalProps {
  onClose: () => void;
  userId: string;
}

export function SyncConsentModal({ onClose, userId }: SyncConsentModalProps) {
  const { t } = useLanguage();

  const handleEnable = () => {
    if (userId) {
      setCloudSyncEnabled(userId, true);
      void SyncService.syncPending(userId);
    }
    onClose();
  };

  const handleKeepOff = () => {
    if (userId) {
      setCloudSyncEnabled(userId, false);
    }
    onClose();
  };

  return (
    <ModalShell
      open
      onClose={handleKeepOff}
      labelId="sync-consent-title"
      z="critical"
      className="w-full max-w-md bg-surface-card border border-border-subtle rounded-2xl shadow-2xl overflow-hidden p-6"
    >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-brand-soft/10 flex items-center justify-center text-brand-soft">
            <Cloud size={20} />
          </div>
          <h3 id="sync-consent-title" className="text-lg font-semibold text-text-primary">
            {t('sync_consent_title')}
          </h3>
        </div>
        <p className="text-sm text-text-muted mb-6 leading-relaxed">
          {t('sync_consent_body')}
        </p>
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            onClick={handleEnable}
            className="w-full justify-center py-2.5 text-sm font-medium"
          >
            {t('sync_consent_enable')}
          </Button>
          <Button
            variant="ghost"
            onClick={handleKeepOff}
            className="w-full justify-center py-2.5 text-sm font-medium text-text-muted hover:text-text-primary"
          >
            {t('sync_consent_keep_off')}
          </Button>
        </div>
    </ModalShell>
  );
}

/** suspended: пока открыт мастер приглашения, вопрос задаёт он сам. Проверка
 * перезапускается, когда мастер закрылся, и читает уже записанный им ответ —
 * иначе окно всплывало по решению, принятому до мастера. */
export function useSyncConsentCheck(suspended = false) {
  const { user, isAuthenticated, isGuest, authState } = useAuthStatus();
  const [showConsent, setShowConsent] = useState(false);

  useEffect(() => {
    // Only ask when explicitly authenticated and auth is fully ready
    if (suspended || authState !== 'authenticated' || !isAuthenticated || isGuest || !user) {
      // Defer to avoid synchronous setState in effect body
      const t = setTimeout(() => setShowConsent(false), 0);
      return () => clearTimeout(t);
    }

    let cancelled = false;
    const checkLocalDocs = async () => {
      // LS-2: Adopt legacy unscoped keys for the first signed-in account that reads them
      const scopedEnabled = localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(user.uid));
      const scopedAsked = localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ASKED(user.uid));
      if (scopedEnabled === null && scopedAsked === null) {
        const legacyEnabled = localStorage.getItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ENABLED);
        const legacyAsked = localStorage.getItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ASKED);
        if (legacyEnabled !== null || legacyAsked !== null) {
          if (legacyEnabled !== null) {
            localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(user.uid), legacyEnabled);
            localStorage.removeItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ENABLED);
          }
          if (legacyAsked !== null) {
            localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ASKED(user.uid), legacyAsked);
            localStorage.removeItem(STORAGE_KEYS.LEGACY_AUTO_SYNC_ASKED);
          }
        }
      }

      // If auto_sync_enabled key is already set or auto_sync_asked is already set, don't ask
      if (
        localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(user.uid)) !== null ||
        localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ASKED(user.uid)) !== null
      ) {
        if (!cancelled) setShowConsent(false);
        return;
      }

      // D-22: Показывать каждому аккаунту при первом входе, даже если заметок ещё нет.
      if (!cancelled) {
        setShowConsent(true);
      }
    };

    void checkLocalDocs();
    return () => { cancelled = true; };
  }, [user, isAuthenticated, isGuest, authState, suspended]);

  return { showConsent, setShowConsent };
}
