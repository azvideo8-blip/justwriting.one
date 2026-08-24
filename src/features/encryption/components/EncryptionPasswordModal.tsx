import React, { useState, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Lock, Shield, AlertTriangle, AlertCircle, Loader2, KeyRound, Cloud } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { reportError } from '../../../shared/errors/reportError';
import { Button } from '../../../shared/components/Button';
import { Input } from '../../../shared/components/Input';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useFocusTrap } from '../../../shared/hooks/useFocusTrap';
import { useModalEscape } from '../../../shared/hooks/useModalEscape';
import { RecoveryCodeDisplayModal } from '../../../shared/components/RecoveryCodeDisplayModal';
import {
  initializeEncryption,
  VaultAlreadyExistsError,
  unlockVault,
  recoverVaultWithCode,
  changePassword,
  WrongPasswordError,
  WrongRecoveryCodeError,
} from '../../../core/services/EncryptionService';
import { migrateFromLegacy } from '../../../core/services/LegacyKeyMigration';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { saveDeviceKey, clearDeviceKey } from '../../../core/crypto/keyVaultCache';
import { setRememberDevice } from '../../../core/crypto/useEncryptionStore';
import type { EncryptionModalMode } from '../hooks/useEncryptionSetup';

interface EncryptionPasswordModalProps {
  mode: EncryptionModalMode;
  userId: string;
  profile?: { encryptionSalt?: string; encryptedDataKey?: string; encryptionMeta?: { salt: string; wrappedDataKey: string } } | null;
  context?: 'cloud-sync';
  onDone: () => void;
  onClose?: () => void;
}

const MIN_PASSWORD_LENGTH = 8;

export function EncryptionPasswordModal({ mode, userId, context, onDone, onClose }: EncryptionPasswordModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const reducedMotion = useReducedMotion();
  const modalRef = useRef<HTMLDivElement>(null);

  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberDevice, setRememberDeviceChecked] = useState(false);
  // Код восстановления, который сейф отдал при создании. Пока он здесь, окно
  // с кодом стоит поверх всего, а `onDone` не зовётся: иначе код исчезает
  // молча, и человек остаётся с сейфом, ключ от которого не видел никто.
  const [createdRecoveryCode, setCreatedRecoveryCode] = useState<string | null>(null);

  const passwordRef = useRef<HTMLInputElement>(null);

  useFocusTrap(modalRef, mode !== 'none');
  useModalEscape(mode !== 'none', () => onClose?.());

  React.useEffect(() => {
    if (mode !== 'none') {
      setTimeout(() => passwordRef.current?.focus(), 100);
    }
  }, [mode]);

  const setupInFlightRef = useRef(false);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    // Ref, не state: два клика в одном кадре видят одно и то же устаревшее
    // значение state, а loading ещё не перерисовался ко второму клику.
    if (setupInFlightRef.current || loading) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('enc_password_min_length', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('enc_passwords_dont_match'));
      return;
    }
    setupInFlightRef.current = true;
    setLoading(true);
    try {
      const { recoveryCode: created } = await initializeEncryption(userId, password);
      showToast(t('enc_setup_success'), 'success');
      setPassword('');
      setConfirmPassword('');
      if (created) {
        setCreatedRecoveryCode(created);
      } else {
        onDone();
      }
    } catch (err) {
      reportError(err, { action: 'initializeEncryption', userId });
      setError(err instanceof VaultAlreadyExistsError ? t('enc_setup_vault_exists') : t('error_generic_action'));
    } finally {
      setupInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      await unlockVault(userId, password);
      if (rememberDevice) {
        const key = getSessionKey();
        if (key) { await saveDeviceKey(userId, key); setRememberDevice(true); }
      } else {
        await clearDeviceKey(userId);
      }
      showToast(t('unlock_success'), 'success');
      setPassword('');
      onDone();
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        setError(t('unlock_wrong_password'));
      } else {
        reportError(err, { action: 'unlockVault', userId });
        setError(t('unlock_cloud_unreachable'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryCode) {
      setError(t('auth_error_fields_required'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('enc_password_min_length', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('enc_passwords_dont_match'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await recoverVaultWithCode(userId, recoveryCode, password);
      showToast(t('enc_recovery_success'), 'success');
      setPassword('');
      setConfirmPassword('');
      setRecoveryCode('');
      onDone();
    } catch (err) {
      if (err instanceof WrongRecoveryCodeError) {
        setError(t('enc_recovery_code_wrong'));
      } else {
        reportError(err, { action: 'recoverVaultWithCode', userId });
        setError(t('error_generic_action'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      setError(t('auth_error_fields_required'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('enc_password_min_length', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('enc_passwords_dont_match'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await changePassword(userId, currentPassword, password);
      showToast(t('enc_password_changed'), 'success');
      setCurrentPassword('');
      setPassword('');
      setConfirmPassword('');
      onDone();
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        setError(t('unlock_wrong_password'));
      } else {
        reportError(err, { action: 'changeEncryptionPassword', userId });
        setError(t('error_generic_action'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMigrate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      setError(t('auth_error_fields_required'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('enc_password_min_length', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('enc_passwords_dont_match'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // AUD-14: миграция выдаёт код восстановления — показываем его один раз,
      // как при создании сейфа.
      const { recoveryCode } = await migrateFromLegacy(userId, currentPassword, password);
      setCreatedRecoveryCode(recoveryCode);
      setPassword('');
      setConfirmPassword('');
      setCurrentPassword('');
    } catch (err) {
      if (err instanceof Error && err.message === 'LEGACY_MIGRATION_WRONG_PASSWORD') {
        setError(t('enc_migrate_wrong_password'));
      } else {
        reportError(err, { action: 'migrateFromLegacy', userId });
        setError(t('error_generic_action'));
      }
    } finally {
      setLoading(false);
    }
  };

  if (createdRecoveryCode) {
    return (
      <RecoveryCodeDisplayModal
        recoveryCode={createdRecoveryCode}
        onConfirm={() => {
          setCreatedRecoveryCode(null);
          onDone();
        }}
      />
    );
  }

  if (mode === 'none') return null;

  const isSetup = mode === 'setup';
  const isUnlock = mode === 'unlock';
  const isChange = mode === 'change';
  const isMigrate = mode === 'migrate';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[var(--z-critical)] flex items-center justify-center bg-surface-base/90 backdrop-blur-md"
        onClick={onClose ? () => onClose() : undefined}
      >
        <motion.div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="enc-modal-title"
          initial={reducedMotion ? {} : { scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={reducedMotion ? {} : { scale: 0.95, opacity: 0 }}
          className="w-full max-w-[400px] bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-10 h-10 rounded-2xl bg-brand-soft/10 border border-brand-soft/30 flex items-center justify-center mb-4">
            {isRecovering ? (
              <KeyRound size={18} className="text-brand-soft" />
            ) : isUnlock ? (
              <Lock size={18} className="text-brand-soft" />
            ) : isMigrate ? (
              <KeyRound size={18} className="text-brand-soft" />
            ) : (
              <Shield size={18} className="text-brand-soft" />
            )}
          </div>

          <h2 id="enc-modal-title" className="text-base font-medium text-text-main mb-1">
            {isRecovering && t('enc_recovery_title')}
            {!isRecovering && isUnlock && t('enc_unlock_title')}
            {isSetup && t('enc_setup_title')}
            {isChange && t('enc_change_title')}
            {isMigrate && t('enc_migrate_title')}
          </h2>
          <p className="text-sm text-text-main/60 mb-4">
            {isRecovering && t('enc_recovery_subtitle')}
            {!isRecovering && isUnlock && t('enc_unlock_subtitle')}
            {isSetup && t('enc_setup_subtitle')}
            {isChange && t('enc_change_subtitle')}
            {isMigrate && t('enc_migrate_subtitle')}
          </p>

          {error && (
            <div role="alert" className="p-3 rounded-lg bg-accent-danger/10 border border-accent-danger/20 text-accent-danger text-xs mb-3 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          {isSetup && context === 'cloud-sync' && (
            <div className="p-3 rounded-lg bg-brand-soft/10 border border-brand-soft/20 text-brand-soft text-xs mb-3 flex gap-2">
              <Cloud size={14} className="shrink-0 mt-0.5" />
              <span>{t('enc_cloud_sync_notice')}</span>
            </div>
          )}

          {(isSetup || isMigrate) && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs mb-3 flex gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{t('enc_password_warning')}</span>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (isRecovering) void handleRecover(e);
              else if (isUnlock) void handleUnlock(e);
              else if (isSetup) void handleSetup(e);
              else if (isChange) void handleChangePassword(e);
              else void handleMigrate(e);
            }}
            className="space-y-3"
          >
            {isRecovering && (
              <Input
                type="text"
                autoFocus
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                placeholder={t('enc_recovery_code_placeholder')}
                aria-label={t('enc_recovery_code_label')}
                className="font-mono px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-brand-soft/40 placeholder:text-text-main/40 uppercase"
                required
              />
            )}

            {!isRecovering && (isChange || isMigrate) && (
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={isMigrate ? t('enc_migrate_current_password') : t('enc_current_password')}
                aria-label={isMigrate ? t('enc_migrate_current_password') : t('enc_current_password')}
                className="px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-brand-soft/40 placeholder:text-text-main/40"
                required
                autoFocus={isChange || isMigrate}
              />
            )}

            <Input
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                isRecovering
                  ? t('enc_recovery_new_password')
                  : isUnlock
                  ? '••••••••'
                  : t('enc_new_password_placeholder')
              }
              aria-label={isUnlock && !isRecovering ? t('unlock_title') : t('enc_new_password_placeholder')}
              className="px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-brand-soft/40 placeholder:text-text-main/40"
              required
              autoFocus={(!isRecovering && isUnlock) || isSetup}
              minLength={isUnlock && !isRecovering ? undefined : MIN_PASSWORD_LENGTH}
            />

            {(isRecovering || !isUnlock) && (
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={isRecovering ? t('enc_recovery_confirm_password') : t('enc_confirm_password')}
                aria-label={t('enc_confirm_password')}
                className="px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-brand-soft/40 placeholder:text-text-main/40"
                required
                minLength={MIN_PASSWORD_LENGTH}
              />
            )}

            {!isRecovering && isUnlock && (
              <label className="flex items-center gap-2.5 px-1 cursor-pointer select-none text-sm text-text-main/70">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDeviceChecked(e.target.checked)}
                  className="w-4 h-4 accent-[var(--brand-primary)]"
                />
                {t('enc_remember_device')}
              </label>
            )}

            <Button
              type="submit"
              disabled={
                loading ||
                !password ||
                (isRecovering && (!recoveryCode || !confirmPassword)) ||
                (!isUnlock && !confirmPassword)
              }
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors flex items-center justify-center gap-2 bg-[var(--brand-primary)]"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isRecovering ? (
                <KeyRound size={14} />
              ) : isUnlock ? (
                <Lock size={14} />
              ) : (
                <Shield size={14} />
              )}
              {isRecovering && t('enc_recovery_submit')}
              {!isRecovering && isUnlock && t('enc_unlock_submit')}
              {isSetup && t('enc_setup_submit')}
              {isChange && t('enc_change_submit')}
              {isMigrate && t('enc_migrate_submit')}
            </Button>

            {isUnlock && !isRecovering && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsRecovering(true);
                    setError(null);
                  }}
                  className="text-xs text-text-main/60 hover:text-text-main underline transition-colors"
                >
                  {t('enc_recovery_link')}
                </button>
              </div>
            )}

            {isUnlock && isRecovering && (
              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsRecovering(false);
                    setError(null);
                  }}
                  className="text-xs text-text-main/60 hover:text-text-main transition-colors"
                >
                  {t('enc_recovery_back_to_password')}
                </button>
              </div>
            )}
          </form>

          {isMigrate && (
            <p className="text-xs text-text-main/60 mt-3 text-center">
              {t('enc_migrate_hint')}
            </p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function ChangeEncryptionPasswordButton({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();
  const { profile } = useAuthStatus();

  if (!(profile?.encryptionMeta || profile?.encryptionSalt)) return null;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-colors text-left"
      >
        <KeyRound size={16} className="text-text-main/60" />
        {t('enc_change_password_btn')}
      </Button>
      {open && (
        <EncryptionPasswordModal
          mode="change"
          userId={userId}
          onDone={() => setOpen(false)}
        />
      )}
    </>
  );
}
