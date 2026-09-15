import React, { useState } from 'react';
import { ModalWrapper } from '../../../shared/components/ModalWrapper';
import { Button } from '../../../shared/components/Button';
import { Users, Trash2, Loader2 } from 'lucide-react';

export interface OtherUserDataModalProps {
  open: boolean;
  onClose: () => void;
  onClear: () => Promise<unknown>;
}

export function OtherUserDataModal({ open, onClose, onClear }: OtherUserDataModalProps) {
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
    <ModalWrapper
      isOpen={open}
      onClose={() => { if (!clearing) onClose(); }}
      titleId="other-user-data-title"
      maxWidth="max-w-md"
    >
      <div className="space-y-4 p-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-warning/10 text-accent-warning flex items-center justify-center border border-accent-warning/20 shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h2 id="other-user-data-title" className="text-base font-semibold text-text-main">
              Данные предыдущего пользователя
            </h2>
          </div>
        </div>

        <div className="space-y-2 text-xs text-text-main/70 leading-relaxed">
          <p>
            На этом устройстве обнаружены локальные записи предыдущей учётной записи.
          </p>
          <p>
            Они изолированы и не видны в ваших заметках. Вы можете очистить их, чтобы освободить место на устройстве.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-border-subtle">
          <Button
            onClick={onClose}
            disabled={clearing}
            className="px-4 py-2 text-xs text-text-main/70 hover:text-text-main"
          >
            Оставить
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
            Очистить чужие данные
          </Button>
        </div>
      </div>
    </ModalWrapper>
  );
}
