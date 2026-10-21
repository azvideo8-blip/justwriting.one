import React, { useState } from 'react';
import { ModalShell } from '../../../shared/components/ModalShell';
import { Button } from '../../../shared/components/Button';
import { Users, Trash2, Loader2 } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';

export interface OtherUserDataModalProps {
  open: boolean;
  onClose: () => void;
  onClear: () => Promise<unknown>;
}

export function OtherUserDataModal({ open, onClose, onClear }: OtherUserDataModalProps) {
  const { t } = useLanguage();
  const [clearing, setClearing] = useState(false);

  const handleClear = async () => {
    setClearing(true);
    try {
      await onClear();
      onClose();
    } finally {
      setClearing(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={() => { if (!clearing) onClose(); }}
      labelId="other-user-data-title"
      // A-9b: ModalWrapper рисовал карточку сам, ModalShell — нет.
      className="max-w-md bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg"
    >
      <div className="space-y-4 p-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-warning/10 text-accent-warning flex items-center justify-center border border-accent-warning/20 shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h2 id="other-user-data-title" className="text-base font-semibold text-text-main">
              {t('other_user_data_title')}
            </h2>
          </div>
        </div>

        <div className="space-y-2 text-xs text-text-main/70 leading-relaxed">
          <p>
            {t('other_user_data_desc_1')}
          </p>
          <p>
            {t('other_user_data_desc_2')}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-border-subtle">
          <Button
            onClick={onClose}
            disabled={clearing}
            className="px-4 py-2 text-xs text-text-main/70 hover:text-text-main"
          >
            {t('other_user_data_btn_keep')}
          </Button>
          <Button
            onClick={() => void handleClear()}
            disabled={clearing}
            className="px-4 py-2 text-xs font-semibold bg-accent-danger/20 text-accent-danger border border-accent-danger/30 hover:bg-accent-danger/30 flex items-center gap-2"
          >
            {clearing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            {t('other_user_data_btn_clear')}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
