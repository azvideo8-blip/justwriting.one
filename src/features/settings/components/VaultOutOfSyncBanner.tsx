import { useState } from 'react';
import { AlertCircle, KeyRound } from 'lucide-react';
import { EncryptionService } from '../../../core/services/EncryptionService';
import { useVaultPasswordOutOfSync } from '../../../core/crypto/useVaultPasswordOutOfSync';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { Button } from '../../../shared/components/Button';
import { RecoveryCodeDisplayModal } from '../../../shared/components/RecoveryCodeDisplayModal';
import { reportError } from '../../../shared/errors/reportError';

/**
 * R7F-006. Плашка не блокирует и не спорит: сейф открыт, работать можно. Задача
 * одна — чтобы состояние «сейф на прежнем пароле» не было тайной до момента,
 * когда устройство потеряно и прежний пароль вместе с ним.
 *
 * Выпуск кода отсюда работает, только когда ключ устройства выгружаемый:
 * `generateRecoveryCodeForExistingVault` без пароля берёт ключ сессии. Не
 * выгружается — просим прежний пароль сейфа (раздел ниже это умеет).
 */
export function VaultOutOfSyncBanner({ userId }: { userId: string }) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { refreshProfile } = useAuthStatus();
  const outOfSync = useVaultPasswordOutOfSync(userId);

  const [busy, setBusy] = useState(false);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [needsVaultPassword, setNeedsVaultPassword] = useState(false);

  if (!outOfSync) return null;

  const issueCode = async () => {
    setBusy(true);
    setNeedsVaultPassword(false);
    try {
      const code = await EncryptionService.generateRecoveryCodeForExistingVault(userId);
      // Без этого плашка «код не создан» висит над только что выпущенным кодом.
      await refreshProfile().catch(() => {});
      setIssuedCode(code);
    } catch (err) {
      if (err instanceof EncryptionService.KeyNotExtractableError) {
        setNeedsVaultPassword(true);
      } else {
        reportError(err, { action: 'vaultOutOfSync_issueCode', userId });
        showToast(t('error_generic_action'), 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        data-testid="vault-out-of-sync"
        role="status"
        className="p-4 rounded-xl border border-accent-warning/30 bg-accent-warning/5 space-y-3"
      >
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-accent-warning mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 space-y-1">
            <div className="text-sm font-medium text-text-main">{t('vault_out_of_sync_title')}</div>
            <div className="text-xs text-text-main/60 leading-relaxed">{t('vault_out_of_sync_desc')}</div>
            {needsVaultPassword && (
              <div className="text-xs text-accent-warning leading-relaxed">{t('vault_out_of_sync_needs_password')}</div>
            )}
          </div>
        </div>
        <Button
          onClick={() => void issueCode()}
          disabled={busy}
          className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border border-accent-warning/40 text-text-main hover:brightness-110 transition-colors"
        >
          <KeyRound size={14} aria-hidden="true" />
          {t('enc_generate_recovery_code_btn')}
        </Button>
      </div>

      {issuedCode !== null && (
        <RecoveryCodeDisplayModal recoveryCode={issuedCode} onConfirm={() => setIssuedCode(null)} />
      )}
    </>
  );
}
