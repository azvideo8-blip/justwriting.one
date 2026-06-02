import React, { useState } from 'react';
import { Lock, Shield } from 'lucide-react';
import { EncryptionService, WrongPasswordError } from '../../../core/services/EncryptionService';
import { useLanguage } from '../../../core/i18n';
import { useToast } from '../../../shared/components/Toast';
import { reportError } from '../../../core/errors/reportError';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';
import { type MigrationProgress } from '../../../core/crypto/encryptMigration';
import { Section } from './SettingsHelpers';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { ChangeEncryptionPasswordButton, EncryptionPasswordModal } from '../../encryption/components/EncryptionPasswordModal';

interface AccountVaultSectionProps {
  userId: string;
}

export function AccountVaultSection({ userId }: AccountVaultSectionProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { profile } = useAuthStatus();
  const isVaultUnlocked = useEncryptionStore(s => s.isVaultUnlocked);

  const [vaultPassword, setVaultPassword] = useState('');
  const [confirmVaultPassword, setConfirmVaultPassword] = useState('');
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [showMigrate, setShowMigrate] = useState(false);

  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [migrationDone, setMigrationDone] = useState(false);
  const migrationAbortRef = React.useRef<AbortController | null>(null);

  const hasNewMeta = !!profile?.encryptionMeta;
  const isLegacyOnly = !hasNewMeta && !!(profile?.encryptionSalt && profile?.encryptedDataKey);
  const hasEncryption = hasNewMeta || isLegacyOnly;

  const handleUnlockVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultPassword) return;
    setVaultLoading(true);
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
      setVaultLoading(false);
    }
  };

  const handleInitializeEncryption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultPassword || vaultPassword.length < 8) {
      setVaultError(t('enc_password_min_length', { min: 8 }));
      return;
    }
    if (vaultPassword !== confirmVaultPassword) {
      setVaultError(t('settings_passwords_dont_match'));
      return;
    }
    setVaultLoading(true);
    setVaultError(null);

    try {
      await EncryptionService.initializeEncryption(userId, vaultPassword);
      showToast(t('unlock_success') || 'Encryption set up successfully', 'success');
      setVaultPassword('');
      setConfirmVaultPassword('');
    } catch (err) {
      reportError(err, { action: 'initializeEncryptionInSettings', userId });
      setVaultError(t('error_generic_action'));
    } finally {
      setVaultLoading(false);
    }
  };

  const handleLockVault = () => {
    EncryptionService.lockVault(userId);
    showToast(t('settings_lock_vault') || 'Vault locked', 'success');
  };

  const handleEncryptAll = async () => {
    const abortCtrl = new AbortController();
    migrationAbortRef.current = abortCtrl;
    setMigrationRunning(true);
    setMigrationDone(false);
    setMigrationProgress(null);
    try {
      await EncryptionService.encryptAll(userId, setMigrationProgress, abortCtrl.signal);
      setMigrationDone(true);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        showToast(t('cancel') || 'Отменено', 'error');
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
            <Shield size={18} className="text-text-main/40 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="text-sm font-medium text-text-main">{t('settings_encryption_not_set')}</div>
              <div className="text-xs text-text-main/60 leading-relaxed">{t('settings_encryption_not_set_desc')}</div>
            </div>
          </div>
          {vaultError && (
            <div className="p-3 rounded-lg text-xs bg-accent-danger/10 border border-accent-danger/30 text-accent-danger">{vaultError}</div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); void handleInitializeEncryption(e); }} className="space-y-3 pt-1">
            <input
              type="password"
              value={vaultPassword}
              onChange={(e) => setVaultPassword(e.target.value)}
              placeholder={t('settings_initialize_password')}
              className="w-full px-4 py-3 rounded-xl outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
              required
            />
            <input
              type="password"
              value={confirmVaultPassword}
              onChange={(e) => setConfirmVaultPassword(e.target.value)}
              placeholder={t('settings_initialize_confirm')}
              className="w-full px-4 py-3 rounded-xl outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
              required
            />
            <button
              type="submit"
              disabled={vaultLoading}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors flex items-center justify-center gap-2 bg-brand-primary"
            >
              {vaultLoading ? (
                <div className="w-4 h-4 border-2 rounded-full animate-spin border-white/20 border-t-white" />
              ) : (
                <>
                  <Shield size={14} />
                  {t('settings_initialize_submit')}
                </>
              )}
            </button>
          </form>
        </div>
      ) : isLegacyOnly ? (
        <div className="p-4 rounded-xl border border-border-subtle space-y-4">
          <div className="flex items-start gap-3">
            <Shield size={18} className="text-text-main/40 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="text-sm font-medium text-text-main">{t('enc_migrate_title')}</div>
              <div className="text-xs text-text-main/60 leading-relaxed">{t('enc_migrate_subtitle')}</div>
            </div>
          </div>
          <button
            onClick={() => setShowMigrate(true)}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-white hover:brightness-110 transition-colors flex items-center justify-center gap-2 bg-brand-primary"
          >
            <Shield size={14} />
            {t('enc_migrate_submit')}
          </button>
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
            <Lock size={18} className="text-text-main/40 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="text-sm font-medium text-text-main">{t('settings_encryption_locked')}</div>
              <div className="text-xs text-text-main/60 leading-relaxed">{t('settings_encryption_locked_desc')}</div>
            </div>
          </div>
          {vaultError && (
            <div className="p-3 rounded-lg text-xs bg-accent-danger/10 border border-accent-danger/30 text-accent-danger">{vaultError}</div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); void handleUnlockVault(e); }} className="space-y-3 pt-1">
            <input
              type="password"
              value={vaultPassword}
              onChange={(e) => setVaultPassword(e.target.value)}
              placeholder={t('auth_password') || 'Password'}
              className="w-full px-4 py-3 rounded-xl outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
              required
            />
            <button
              type="submit"
              disabled={vaultLoading}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors flex items-center justify-center gap-2 bg-brand-primary"
            >
              {vaultLoading ? (
                <div className="w-4 h-4 border-2 rounded-full animate-spin border-white/20 border-t-white" />
              ) : (
                <>
                  <Lock size={14} />
                  {t('settings_unlock_submit')}
                </>
              )}
            </button>
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
            
            <button
              onClick={handleLockVault}
              className="mt-2 text-xs font-semibold text-text-main/40 hover:text-accent-danger transition-colors flex items-center gap-1.5"
            >
              <Lock size={12} />
              {t('settings_lock_vault')}
            </button>
          </div>

          <ChangeEncryptionPasswordButton userId={userId} />

          {!migrationRunning && !migrationDone ? (
          <button
            onClick={() => void handleEncryptAll()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-colors text-left"
          >
              <Shield size={16} className="text-text-main/40" />
              {t('settings_encrypt_all')}
            </button>
          ) : migrationRunning ? (
            <div className="p-4 rounded-xl border border-border-subtle space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-text-main/60">{t('settings_encrypting_progress')}</div>
                <button
                  onClick={handleAbortEncryption}
                  className="text-xs text-text-main/40 hover:text-accent-danger transition-colors"
                >
                  {t('cancel') || 'Отмена'}
                </button>
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
                <div className="text-xs text-text-main/40">
                  {migrationProgress.processed} / {migrationProgress.total} ({migrationProgress.encrypted} {t('settings_encrypted_label')})
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-green-500/20 bg-green-500/5">
              <div className="text-sm text-green-400">{t('settings_encrypt_done', { count: migrationProgress?.encrypted ?? 0 })}</div>
              {migrationProgress && migrationProgress.errors > 0 && (
                <div className="text-xs text-text-main/40 mt-1">{t('settings_encrypt_errors', { count: migrationProgress.errors })}</div>
              )}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
