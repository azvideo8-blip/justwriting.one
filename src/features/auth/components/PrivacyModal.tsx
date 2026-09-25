import React, { useState } from 'react';
import { reportError } from '../../../shared/errors/reportError';
import { Shield } from 'lucide-react';
import { getCurrentUser } from '../../../core/auth';
import { PrivacyConsentBody, savePrivacyConsent } from './PrivacyConsentBody';
import { Button } from '../../../shared/components/Button';
import { ModalShell } from '../../../shared/components/ModalShell';
import { PRIVACY_VERSION } from '../../../core/constants/privacyVersion';

interface PrivacyModalProps {
  onAccepted: () => void;
}

export function PrivacyModal({ onAccepted }: PrivacyModalProps) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aiConsent, setAiConsent] = useState(false);

  const handleAccept = async () => {
    if (!checked) return;
    const user = getCurrentUser();
    if (!user) return;

    // Без try/catch любая неудача записи выглядела как «кнопка не нажимается»:
    // окно оставалось на месте и молчало. На это ушло полдня 2026-08-18.
    setSaveError(null);
    setSaving(true);
    try {
      await savePrivacyConsent(user.uid, aiConsent);
    } catch (e) {
      reportError(e, { action: 'privacyAccept', userId: user.uid });
      setSaveError('Не удалось сохранить согласие. Проверьте связь и попробуйте ещё раз.');
      return;
    } finally {
      setSaving(false);
    }

    onAccepted();
  };

  return (
    <ModalShell
      open
      labelId="privacy-modal-title"
      onClose={() => { /* обязательное согласие: Escape и клик по фону не закрывают */ }}
      className="w-full max-w-md max-h-[calc(100dvh-2rem)] bg-surface-card border border-border-subtle rounded-2xl shadow-2xl overflow-y-auto m-4"
    >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Shield size={20} className="text-brand-soft" />
            <h2 id="privacy-modal-title" className="text-base font-bold text-text-main">Политика конфиденциальности</h2>
          </div>

          <PrivacyConsentBody checked={checked} onChecked={setChecked} aiConsent={aiConsent} onAiConsent={setAiConsent} />

          {saveError !== null && (
            <p className="mt-3 text-xs text-accent-danger">{saveError}</p>
          )}

          <Button
            onClick={() => void handleAccept()}
            disabled={!checked || saving}
            className="w-full mt-4 py-2.5 rounded-xl bg-brand-soft text-surface-base text-sm font-bold disabled:opacity-40 transition-colors"
          >
            Продолжить
          </Button>
        </div>
    </ModalShell>
  );
}

// Версия текста согласия. Поднимается вместе с любым содержательным изменением
// формулировок: согласие, данное на прежний текст, нового не покрывает. Версия 2
// (2026-08-18) — первая, где сказано, что запрос к модели может уйти за границу.


// Ре-экспорт для обратной совместимости: часть кода импортирует константу отсюда.
export { PRIVACY_VERSION };
