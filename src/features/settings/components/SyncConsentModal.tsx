import { useRef } from 'react';
import { useFocusTrap } from '../../../shared/hooks/useFocusTrap';
import { useModalEscape } from '../../../shared/hooks/useModalEscape';
import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Cloud } from "lucide-react";
import { Button } from "../../../shared/components/Button";
import { useLanguage } from "../../../shared/i18n";
import { useAuthStatus } from "../../../features/auth/hooks/useAuthStatus";
import { STORAGE_KEYS } from "../../../shared/constants/storageKeys";
import { getLocalDb } from "../../../core/storage/localDb";
import { SyncService } from "../../../core/services/SyncService";

interface SyncConsentModalProps {
  onClose: () => void;
  userId: string;
}

export function SyncConsentModal({ onClose, userId }: SyncConsentModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalEscape(true, onClose);
  useFocusTrap(modalRef, true);
  const { t } = useLanguage();

  const handleEnable = () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED, "true");
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ASKED, "true");
    if (userId) {
      void SyncService.syncPending(userId);
    }
    onClose();
  };

  const handleKeepOff = () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED, "false");
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ASKED, "true");
    onClose();
  };

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[var(--z-critical)] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="absolute inset-0" onClick={handleKeepOff} />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative z-10 w-full max-w-md bg-surface-card border border-border-subtle rounded-2xl shadow-2xl overflow-hidden p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-brand-soft/10 flex items-center justify-center text-brand-soft">
            <Cloud size={20} />
          </div>
          <h2 className="text-base font-bold text-text-main">
            {t("sync_consent_title")}
          </h2>
        </div>

        <p className="text-sm text-text-main/70 leading-relaxed mb-3">
          {t("sync_consent_body")}
        </p>

        <p className="text-xs text-text-main/50 mb-6">
          {t("sync_consent_hint")}
        </p>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <Button
            variant="ghost"
            onClick={handleKeepOff}
            className="flex-1 py-2.5 rounded-xl border border-border-subtle text-text-main/70 text-sm font-medium hover:bg-text-main/5 hover:text-text-main transition-colors text-center justify-center"
          >
            {t("sync_consent_keep_off")}
          </Button>
          <Button
            variant="ghost"
            onClick={handleEnable}
            className="flex-1 py-2.5 rounded-xl bg-text-main/10 border border-text-main/15 text-text-main text-sm font-medium hover:bg-text-main/15 transition-colors text-center justify-center"
          >
            {t("sync_consent_enable")}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

export function useSyncConsentCheck() {
  const [showConsent, setShowConsent] = useState(false);
  const { user, isAuthenticated, isGuest, authState } = useAuthStatus();

  useEffect(() => {
    if (authState === "loading") return;

    let cancelled = false;
    const checkLocalDocs = async () => {
      if (!isAuthenticated || isGuest || !user) {
        if (!cancelled) setShowConsent(false);
        return;
      }

      // If auto_sync_enabled key is already set or auto_sync_asked is already set, don't ask
      if (
        localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED) !== null ||
        localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ASKED) !== null
      ) {
        if (!cancelled) setShowConsent(false);
        return;
      }

      try {
        const db = await getLocalDb();
        const docCount = await db.count("documents");
        if (cancelled) return;
        if (docCount > 0) {
          setShowConsent(true);
        } else {
          setShowConsent(false);
        }
      } catch {
        if (!cancelled) setShowConsent(false);
      }
    };

    void checkLocalDocs();
    return () => { cancelled = true; };
  }, [user, isAuthenticated, isGuest, authState]);

  return { showConsent, setShowConsent };
}
