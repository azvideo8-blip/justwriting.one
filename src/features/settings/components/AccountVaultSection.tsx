import React, { useState } from 'react';
import { Lock, Shield, KeyRound, AlertCircle, Loader2 } from 'lucide-react';
import { EncryptionService, WrongPasswordError, hasVault } from '../../../core/services/EncryptionService';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { reportError } from '../../../shared/errors/reportError';
import { useEncryptionStore, setRememberDevice } from '../../../core/crypto/useEncryptionStore';
import { clearDeviceKey } from '../../../core/crypto/keyVaultCache';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { type MigrationProgress } from '../../../core/crypto/encryptMigration';
import { Section } from './SettingsHelpers';
import { MIN_PASSWORD_LENGTH } from '../../../shared/constants/passwordPolicy';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { EncryptionPasswordModal } from '../../../app/EncryptionPasswordModal';
import { getCurrentUser, reauthenticate } from '../../../core/auth';
import { RecoveryCodeDisplayModal } from '../../../shared/components/RecoveryCodeDisplayModal';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { Button } from '../../../shared/components/Button';
import { Input } from '../../../shared/components/Input';
import { LoadingSpinner } from '../../../shared/components/LoadingSpinner';

interface AccountVaultSectionProps {
  userId: string;
}

export function AccountVaultSection({ userId }: AccountVaultSectionProps) {
  const { t } = useLanguage();
  const { confirm } = useConfirmDialog();
  const { showToast } = useToast();
  const { profile, refreshProfile } = useAuthStatus();
  const isVaultUnlocked = useEncryptionStore(s => s.isVaultUnlocked);

  const [vaultPassword, setVaultPassword] = useState('');
  const [confirmVaultPassword, setConfirmVaultPassword] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [showMigrate, setShowMigrate] = useState(false);

  const [generatingRecoveryCode, setGeneratingRecoveryCode] = useState(false);
  const [newGeneratedRecoveryCode, setNewGeneratedRecoveryCode] = useState<string | null>(null);
  const [recoveryPromptOpen, setRecoveryPromptOpen] = useState(false);
  const [recoveryPromptPassword, setRecoveryPromptPassword] = useState('');
  const [recoveryPromptError, setRecoveryPromptError] = useState<string | null>(null);
  const [recoveryPromptBusy, setRecoveryPromptBusy] = useState(false);
  // Новый код отменяет прежний. Спрашиваем до, а не сообщаем после.

  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [migrationDone, setMigrationDone] = useState(false);
  const migrationAbortRef = React.useRef<AbortController | null>(null);

  const hasNewMeta = !!profile?.encryptionMeta;
  const isLegacyOnly = !hasNewMeta && !!(profile?.encryptionSalt && profile?.encryptedDataKey);
  const hasEncryption = hasVault(profile);
  const hasRecoveryCode = !!profile?.encryptionMeta?.recoveryWrappedDataKey;

  const handleUnlockVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultPassword) return;
    setVaultBusy(true);
    setVaultError(null);

    try {
      await EncryptionService.unlockVault(userId, vaultPassword);
      setVaultPassword('');
      showToast(t('unlock_success'), 'success');
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        setVaultError(t('unlock_wrong_password'));
      } else {
        reportError(err, { action: 'unlockVaultInSettings', userId });
        setVaultError(t('error_generic_action'));
      }
    } finally {
      setVaultBusy(false);
    }
  };

  const handleInitializeEncryption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultPassword || vaultPassword.length < MIN_PASSWORD_LENGTH) {
      setVaultError(t('enc_password_min_length', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (vaultPassword !== confirmVaultPassword) {
      setVaultError(t('settings_passwords_dont_match'));
      return;
    }
    setVaultBusy(true);
    setVaultError(null);

    // D-28: один пароль — сейф создаётся только из пароля от аккаунта.
    const email = getCurrentUser()?.email;
    try {
      if (!email) throw new Error('REAUTH_FAILED');
      await reauthenticate(email, vaultPassword);
    } catch {
      setVaultError(t('enc_setup_wrong_account_password'));
      setVaultBusy(false);
      return;
    }

    try {
      const { recoveryCode } = await EncryptionService.initializeEncryption(userId, vaultPassword);
      const mig = await EncryptionService.migrateNotesAfterSetup(userId);
      if (mig.errors > 0) {
        showToast(t('settings_encrypt_partial', { done: mig.encrypted, total: mig.total }), 'error');
      } else if (mig.encrypted > 0) {
        showToast(t('settings_encrypt_done', { count: mig.encrypted }), 'success');
      } else {
        showToast(t('unlock_success'), 'success');
      }
      setVaultPassword('');
      setConfirmVaultPassword('');
      // Как и после создания кода восстановления: снапшот новое значение
      // encryption_meta может не прислать, и раздел останется в прежнем виде.
      await refreshProfile();
      setNewGeneratedRecoveryCode(recoveryCode);
    } catch (err) {
      reportError(err, { action: 'initializeEncryptionInSettings', userId });
      setVaultError(err instanceof EncryptionService.VaultAlreadyExistsError ? t('enc_setup_vault_exists') : t('error_generic_action'));
    } finally {
      setVaultBusy(false);
    }
  };

  const handleGenerateRecoveryCode = async () => {
    const key = getSessionKey();
    if (key && !key.extractable) {
      setRecoveryPromptPassword('');
      setRecoveryPromptError(null);
      setRecoveryPromptOpen(true);
      return;
    }
    setGeneratingRecoveryCode(true);
    try {
      const code = await EncryptionService.generateRecoveryCodeForExistingVault(userId);
      // Без этого плашка «код восстановления не создан» продолжает висеть над
      // только что созданным кодом: подписка на изменения новое значение
      // encryption_meta может не прислать.
      await refreshProfile();
      setNewGeneratedRecoveryCode(code);
    } catch (err) {
      if (err instanceof EncryptionService.KeyNotExtractableError) {
        setRecoveryPromptPassword('');
        setRecoveryPromptError(null);
        setRecoveryPromptOpen(true);
      } else {
        reportError(err, { action: 'generateRecoveryCodeInSettings', userId });
        showToast(t('error_generic_action'), 'error');
      }
    } finally {
      setGeneratingRecoveryCode(false);
    }
  };

  const handleConfirmRecoveryPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryPromptPassword) return;
    setRecoveryPromptBusy(true);
    setRecoveryPromptError(null);
    try {
      const code = await EncryptionService.generateRecoveryCodeForExistingVault(userId, recoveryPromptPassword);
      await refreshProfile();
      setRecoveryPromptOpen(false);
      setRecoveryPromptPassword('');
      setNewGeneratedRecoveryCode(code);
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        setRecoveryPromptError(t('unlock_wrong_password'));
      } else {
        reportError(err, { action: 'generateRecoveryCodeWithPassword', userId });
        setRecoveryPromptError(t('error_generic_action'));
      }
    } finally {
      setRecoveryPromptBusy(false);
    }
  };

  const handleLockVault = async () => {
    EncryptionService.lockVault(userId);
    // Explicit lock cancels "remember on this device" so it won't auto-unlock on reload.
    setRememberDevice(false);
    try {
      await clearDeviceKey(userId);
    } catch (err) {
      // Ключ устройства жив — после перезагрузки сейф откроется сам: «заперт» не говорим.
      reportError(err, { action: 'clearDeviceKey_lockVault', userId });
      showToast(t('settings_vault_lock_device_key_failed'), 'error');
      return;
    }
    showToast(t('settings_vault_locked_done'), 'info');
  };

  const handleEncryptAll = async () => {
    const abortCtrl = new AbortController();
    migrationAbortRef.current = abortCtrl;
    setMigrationRunning(true);
    setMigrationDone(false);
    setMigrationProgress(null);
    try {
      setMigrationProgress(await EncryptionService.encryptAll(userId, setMigrationProgress, abortCtrl.signal));
      setMigrationDone(true);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        showToast(t('common_cancel'), 'error');
      } else {
        reportError(e, { action: 'encryptAllExistingNotes', userId });
        showToast(t('error_generic_action'), 'error');
      }
    } finally {
      setMigrationRunning(false);
      migrationAbortRef.current = null;
    }
  };

  const handleAbortEncryption = () => {
    migrationAbortRef.current?.abort();
  };

  return (
    <Section title={t('settings_encryption')}>
      {!hasEncryption ? (
        <div className="p-4 rounded-xl border border-border-subtle space-y-4">
          <div className="flex items-start gap-3">
            <Shield size={18} className="text-text-main/60 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="text-sm font-medium text-text-main">{t('settings_encryption_not_set')}</div>
              <div className="text-xs text-text-main/60 leading-relaxed">{t('settings_encryption_not_set_desc')}</div>
            </div>
          </div>
          {vaultError && (
            <div className="p-3 rounded-lg text-xs bg-accent-danger/10 border border-accent-danger/30 text-accent-danger">{vaultError}</div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); void handleInitializeEncryption(e); }} className="space-y-3 pt-1">
            <Input
              type="password"
              aria-label={t('settings_initialize_password')}
              value={vaultPassword}
              onChange={(e) => setVaultPassword(e.target.value)}
              placeholder={t('settings_initialize_password')}
              className="px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/40"
              required
            />
            <Input
              type="password"
              aria-label={t('settings_initialize_confirm')}
              value={confirmVaultPassword}
              onChange={(e) => setConfirmVaultPassword(e.target.value)}
              placeholder={t('settings_initialize_confirm')}
              className="px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/40"
              required
            />
            <Button
              type="submit"
              disabled={vaultBusy}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors flex items-center justify-center gap-2 bg-brand-primary"
            >
              {vaultBusy ? (
                <LoadingSpinner size={4} />
              ) : (
                <>
                  <Shield size={14} />
                  {t('settings_initialize_submit')}
                </>
              )}
            </Button>
          </form>
        </div>
      ) : isLegacyOnly ? (
        <div className="p-4 rounded-xl border border-border-subtle space-y-4">
          <div className="flex items-start gap-3">
            <Shield size={18} className="text-text-main/60 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="text-sm font-medium text-text-main">{t('enc_migrate_title')}</div>
              <div className="text-xs text-text-main/60 leading-relaxed">{t('enc_migrate_subtitle')}</div>
            </div>
          </div>
          <Button
            onClick={() => setShowMigrate(true)}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-white hover:brightness-110 transition-colors flex items-center justify-center gap-2 bg-brand-primary"
          >
            <Shield size={14} />
            {t('enc_migrate_submit')}
          </Button>
          {showMigrate && (
            <EncryptionPasswordModal
              mode="migrate"
              userId={userId}
              onDone={() => setShowMigrate(false)}
              onClose={() => setShowMigrate(false)}
            />
          )}
        </div>
      ) : !isVaultUnlocked ? (
        <div className="p-4 rounded-xl border border-border-subtle space-y-4">
          <div className="flex items-start gap-3">
            <Lock size={18} className="text-text-main/60 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="text-sm font-medium text-text-main">{t('settings_encryption_locked')}</div>
              <div className="text-xs text-text-main/60 leading-relaxed">{t('settings_encryption_locked_desc')}</div>
            </div>
          </div>
          {vaultError && (
            <div className="p-3 rounded-lg text-xs bg-accent-danger/10 border border-accent-danger/30 text-accent-danger">{vaultError}</div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); void handleUnlockVault(e); }} className="space-y-3 pt-1">
            <Input
              type="password"
              aria-label={t('auth_password')}
              value={vaultPassword}
              onChange={(e) => setVaultPassword(e.target.value)}
              placeholder={t('auth_password')}
              className="px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/40"
              required
            />
            <Button
              type="submit"
              disabled={vaultBusy}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors flex items-center justify-center gap-2 bg-brand-primary"
            >
              {vaultBusy ? (
                <LoadingSpinner size={4} />
              ) : (
                <>
                  <Lock size={14} />
                  {t('settings_unlock_submit')}
                </>
              )}
            </Button>
          </form>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-4 rounded-xl border border-border-subtle space-y-3 bg-text-main/[0.01]">
            <div className="flex items-start gap-3">
              <Shield size={18} className="text-accent-success mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="text-sm font-medium text-text-main">{t('settings_vault_unlocked')}</div>
                <div className="text-xs text-text-main/60 leading-relaxed">{t('settings_vault_unlocked_desc')}</div>
              </div>
            </div>
            
            <Button
              onClick={() => void handleLockVault()}
              className="mt-2 text-xs font-semibold text-text-main/60 hover:text-accent-danger transition-colors flex items-center gap-1.5"
            >
              <Lock size={12} />
              {t('settings_lock_vault')}
            </Button>
          </div>

          {!hasRecoveryCode && (
            <div className="p-4 rounded-xl border border-accent-warning/30 bg-accent-warning/5 space-y-3">
              <div className="flex items-start gap-3">
                <KeyRound size={18} className="text-accent-warning mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="text-sm font-medium text-text-main">{t('enc_recovery_code_missing_title')}</div>
                  <div className="text-xs text-text-main/60 leading-relaxed">{t('enc_generate_recovery_code_desc')}</div>
                </div>
              </div>
              <Button
                onClick={() => void handleGenerateRecoveryCode()}
                disabled={generatingRecoveryCode}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors flex items-center justify-center gap-2 bg-[var(--brand-primary)]"
              >
                {generatingRecoveryCode ? (
                  <LoadingSpinner size={4} />
                ) : (
                  <>
                    <KeyRound size={14} />
                    {t('enc_generate_recovery_code_btn')}
                  </>
                )}
              </Button>
            </div>
          )}

          {hasRecoveryCode && (
            <div className="p-4 rounded-xl border border-border-subtle space-y-3">
              <div className="flex items-start gap-3">
                <KeyRound size={18} className="text-text-main/60 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="text-sm font-medium text-text-main">{t('enc_recovery_code_present_title')}</div>
                  <div className="text-xs text-text-main/60 leading-relaxed">{t('enc_recovery_code_present_desc')}</div>
                </div>
              </div>
              <Button
                onClick={() => {
                  void (async () => {
                    const ok = await confirm({
                      title: t('enc_regenerate_recovery_confirm_title'),
                      message: t('enc_regenerate_recovery_confirm_desc'),
                      confirmLabel: t('enc_regenerate_recovery_confirm_btn'),
                    });
                    if (ok) void handleGenerateRecoveryCode();
                  })();
                }}
                disabled={generatingRecoveryCode}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-text-main/70 hover:text-text-main disabled:opacity-50 transition-colors flex items-center justify-center gap-2 border border-border-subtle"
              >
                {generatingRecoveryCode ? (
                  <LoadingSpinner size={4} />
                ) : (
                  <>
                    <KeyRound size={14} />
                    {t('enc_regenerate_recovery_code_btn')}
                  </>
                )}
              </Button>
            </div>
          )}


          {!migrationRunning && !migrationDone ? (
          <Button
            onClick={() => void handleEncryptAll()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-colors text-left"
          >
            <Shield size={16} className="text-text-main/60" />
            {t('settings_encrypt_all')}
          </Button>
          ) : migrationRunning ? (
            <div className="p-4 rounded-xl border border-border-subtle space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-text-main/60">{t('settings_encrypting_progress')}</div>
                <Button
                  onClick={handleAbortEncryption}
                  className="text-xs text-text-main/60 hover:text-accent-danger transition-colors"
                >
                  {t('common_cancel')}
                </Button>
              </div>
              {migrationProgress && (
                <div className="w-full bg-text-main/10 rounded-full h-2">
                  <div
                    className="bg-[var(--brand-primary)] h-2 rounded-full transition-colors"
                    style={migrationProgress.total > 0 ? { width: `${(migrationProgress.processed / migrationProgress.total * 100)}%` } : undefined}
                  />
                </div>
              )}
              {migrationProgress && (
                <div className="text-xs text-text-main/60">
                  {migrationProgress.processed} / {migrationProgress.total} ({migrationProgress.encrypted} {t('settings_encrypted_label')})
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-accent-success/20 bg-accent-success/5">
              <div className={migrationProgress?.incomplete || (migrationProgress?.errors ?? 0) > 0 ? 'text-sm text-text-main' : 'text-sm text-accent-success'}>
                {t('settings_encrypt_done', { count: migrationProgress?.encrypted ?? 0 })}
              </div>
              {migrationProgress?.incomplete && (
                <div className="text-xs text-text-main/60 mt-1">{t('settings_encrypt_budget_stop')}</div>
              )}
              {migrationProgress && migrationProgress.errors > 0 && (
                <div className="text-xs text-text-main/60 mt-1">{t('settings_encrypt_errors', { count: migrationProgress.errors })}</div>
              )}
            </div>
          )}
        </div>
      )}

      {recoveryPromptOpen && (
        <div className="fixed inset-0 z-[var(--z-critical)] flex items-center justify-center bg-surface-base/90 backdrop-blur-md" onClick={() => setRecoveryPromptOpen(false)}>
          <div className="w-full max-w-[400px] bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-10 rounded-2xl bg-brand-soft/10 border border-brand-soft/30 flex items-center justify-center mb-4">
              <KeyRound size={18} className="text-brand-soft" />
            </div>
            <h2 className="text-base font-medium text-text-main mb-1">
              {t('enc_recovery_password_prompt_title')}
            </h2>
            <p className="text-sm text-text-main/60 mb-4">
              {t('enc_recovery_password_prompt_desc')}
            </p>
            {recoveryPromptError && (
              <div role="alert" className="p-3 rounded-lg bg-accent-danger/10 border border-accent-danger/20 text-accent-danger text-xs mb-3 flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                {recoveryPromptError}
              </div>
            )}
            <form onSubmit={(e) => void handleConfirmRecoveryPassword(e)} className="space-y-3">
              <Input
                type="password"
                autoFocus
                aria-label={t('auth_password')}
                value={recoveryPromptPassword}
                onChange={e => setRecoveryPromptPassword(e.target.value)}
                placeholder={t('auth_password')}
                className="px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/40"
                required
              />
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setRecoveryPromptOpen(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm"
                >
                  {t('common_cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={recoveryPromptBusy || !recoveryPromptPassword}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-[var(--brand-primary)]"
                >
                  {recoveryPromptBusy ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    t('enc_recovery_password_submit')
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {newGeneratedRecoveryCode && (
        <RecoveryCodeDisplayModal
          recoveryCode={newGeneratedRecoveryCode}
          onConfirm={() => setNewGeneratedRecoveryCode(null)}
        />
      )}

    </Section>
  );
}
