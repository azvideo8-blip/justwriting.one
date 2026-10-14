import React from "react";
import { Cloud } from "lucide-react";
import { Button } from "../../../shared/components/Button";
import { ModalShell } from "../../../shared/components/ModalShell";
import { useLanguage } from "../../../shared/i18n";
import { useLayoutMode } from "../../../shared/hooks/useLayoutMode";
import { cn } from "../../../core/utils/utils";
import { SyncService } from "../../../core/services/SyncService";
import { setCloudSyncEnabled } from "../../../core/sync/cloudSyncEnabled";

interface SyncConsentModalProps {
  onClose: () => void;
  userId: string;
}

export function SyncConsentModal({ onClose, userId }: SyncConsentModalProps) {
  const { t } = useLanguage();
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';

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
      // N-38: Esc и клик мимо окна — «не сейчас отвечать», а не «нет»: окно
      // закрывается до следующего запуска, ответ не записывается.
      onClose={onClose}
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
            className={cn("w-full justify-center py-2.5 text-sm font-medium", isMobile && "min-h-11")}
          >
            {t('sync_consent_enable')}
          </Button>
          <Button
            variant="ghost"
            onClick={handleKeepOff}
            className={cn("w-full justify-center py-2.5 text-sm font-medium text-text-muted hover:text-text-primary", isMobile && "min-h-11")}
          >
            {t('sync_consent_keep_off')}
          </Button>
        </div>
    </ModalShell>
  );
}
