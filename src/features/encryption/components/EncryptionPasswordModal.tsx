import React, { useState, useRef } from 'react';
import { Lock, Shield, AlertTriangle, AlertCircle, Loader2, KeyRound, Cloud, X } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { reportError } from '../../../shared/errors/reportError';
import { MIN_PASSWORD_LENGTH } from '../../../shared/constants/passwordPolicy';
import { Button } from '../../../shared/components/Button';
import { Input } from '../../../shared/components/Input';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { getCurrentUser, reauthenticate } from '../../../core/auth';
import { ModalShell } from '../../../shared/components/ModalShell';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';

// MQ-11: поле ≥ 16 px на телефоне (Safari на iPhone иначе увеличит страницу при фокусе), плейсхолдер —
// `--text-muted` (≥ 4,5:1 во всех темах), а не text-main/40 (≈ 3,4:1).
const FIELD = 'px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-base md:text-sm focus:ring-2 focus:ring-brand-soft/40 placeholder:text-text-muted';
import { RecoveryCodeDisplayModal } from '../../../shared/components/RecoveryCodeDisplayModal';
import {
  initializeEncryption,
  migrateNotesAfterSetup,
  VaultAlreadyExistsError,
  unlockVault,
  recoverVaultWithCode,
  WrongPasswordError,
  WrongRecoveryCodeError,
  LoginPasswordNotUpdatedError,
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



export function EncryptionPasswordModal({ mode, userId, context, onDone, onClose }: EncryptionPasswordModalProps) {
  const { t } = useLanguage();
  const isMobile = useLayoutMode().layoutMode === 'mobile';
  const { showToast } = useToast();
  // Первичная настройка сейфа шла мимо ProfileContext: заметки шифровались
  // (флаг записи + ключ сессии стоят), но раздел настроек читает
  // profile.encryptionMeta и без обновления показывал «Шифрование не
  // настроено». getProfile читает колонку authoritative — обновляем профиль
  // после успешной настройки, как это уже делает AccountVaultSection.
  const { refreshProfile } = useAuthStatus();

  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberDevice, setRememberDeviceChecked] = useState(false);
  const [isAutoCreated, setIsAutoCreated] = useState(false);
  const [unlockFailed, setUnlockFailed] = useState(false);
  // Код восстановления, который сейф отдал при создании. Пока он здесь, окно
  // с кодом стоит поверх всего, а `onDone` не зовётся: иначе код исчезает
  // молча, и человек остаётся с сейфом, ключ от которого не видел никто.
  const [createdRecoveryCode, setCreatedRecoveryCode] = useState<string | null>(null);

  const passwordRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (mode === 'unlock') {
      let active = true;
      void (async () => {
        try {
          const { STORAGE_KEYS } = await import('../../../shared/constants/storageKeys');
          const failedOnLogin = sessionStorage.getItem(STORAGE_KEYS.VAULT_AUTO_UNLOCK_FAILED(userId)) === '1';
          if (failedOnLogin && active) {
            setUnlockFailed(true);
          }
          const localFlag = localStorage.getItem(STORAGE_KEYS.VAULT_AUTO_CREATED(userId)) === '1';
          if (localFlag && active) {
            setIsAutoCreated(true);
            return;
          }
          const { getEncryptionMeta } = await import('../../../core/services/EncryptionMetaService');
          const meta = await getEncryptionMeta(userId);
          if (active && meta?.autoCreated) {
            setIsAutoCreated(true);
          }
        } catch { /* ignore */ }
      })();
      return () => { active = false; };
    }
  }, [mode, userId]);

  React.useEffect(() => {
    if (mode !== 'none') {
      setTimeout(() => passwordRef.current?.focus(), 100);
    }
  }, [mode]);

  const setupInFlightRef = useRef(false);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    // Ref, не state: два клика в одном кадре видят одно и то же устаревшее
    // значение state, а busy ещё не перерисовался ко второму клику.
    if (setupInFlightRef.current || busy) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('enc_password_min_length', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('enc_passwords_dont_match'));
      return;
    }
    setupInFlightRef.current = true;
    setBusy(true);
    // D-28: один пароль — сейф создаётся только из пароля от аккаунта.
    try {
      const email = getCurrentUser()?.email;
      if (!email) throw new Error('REAUTH_FAILED');
      await reauthenticate(email, password);
    } catch {
      setError(t('enc_setup_wrong_account_password'));
      setBusy(false);
      setupInFlightRef.current = false;
      return;
    }
    try {
      const { recoveryCode: created } = await initializeEncryption(userId, password);
      await refreshProfile();
      const mig = await migrateNotesAfterSetup(userId);
      if (mig.errors > 0) {
        showToast(t('settings_encrypt_partial', { done: mig.encrypted, total: mig.total }), 'error');
      } else if (mig.encrypted > 0) {
        showToast(t('settings_encrypt_done', { count: mig.encrypted }), 'success');
      } else {
        showToast(t('enc_setup_success'), 'success');
      }
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
      setBusy(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await unlockVault(userId, password);
      try {
        const { STORAGE_KEYS } = await import('../../../shared/constants/storageKeys');
        sessionStorage.removeItem(STORAGE_KEYS.VAULT_AUTO_UNLOCK_FAILED(userId));
      } catch { /* ignore */ }
      if (rememberDevice) {
        // NB-6: ключ не лёг (отказ IndexedDB или ключа сессии нет) — галочка
        // снята и warning: сейф попросит пароль после перезагрузки.
        const key = getSessionKey();
        const saved = key ? await saveDeviceKey(userId, key) : false;
        if (saved) {
          setRememberDevice(true);
        } else {
          setRememberDeviceChecked(false);
          setRememberDevice(false);
          showToast(t('enc_remember_device_failed'), 'warning');
        }
      } else {
        await clearDeviceKey(userId);
      }
      await refreshProfile();
      showToast(t('unlock_success'), 'success');
      setPassword('');
      onDone();
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        setUnlockFailed(true);
        setError(isAutoCreated ? t('enc_unlock_wrong_password_hint') : t('unlock_wrong_password'));
      } else {
        reportError(err, { action: 'unlockVault', userId });
        setError(t('unlock_cloud_unreachable'));
      }
    } finally {
      setBusy(false);
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
    setBusy(true);
    setError(null);
    try {
      // Пароль входа не сменился — сейф уже перевёрнут и открыт: успех с предупреждением (ревью FN-2).
      const loginNotUpdated = await recoverVaultWithCode(userId, recoveryCode, password).then(
        () => false,
        (err: unknown) => { if (err instanceof LoginPasswordNotUpdatedError) return true; throw err; },
      );
      try {
        const { STORAGE_KEYS } = await import('../../../shared/constants/storageKeys');
        sessionStorage.removeItem(STORAGE_KEYS.VAULT_AUTO_UNLOCK_FAILED(userId));
      } catch { /* ignore */ }
      await refreshProfile();
      if (loginNotUpdated) showToast(t('enc_recovery_login_password_failed'), 'warning');
      else showToast(t('enc_recovery_success'), 'success');
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
      setBusy(false);
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
    setBusy(true);
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
      setBusy(false);
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

  const isSetup = mode === 'setup';
  const isUnlock = mode === 'unlock';
  const isMigrate = mode === 'migrate';

  return (
    <ModalShell
      open={mode !== 'none'}
      onClose={() => onClose?.()}
      labelId="enc-modal-title"
      z="critical"
      variant={isMobile ? 'sheet' : 'modal'}
      className={isMobile
        ? 'p-6 relative overflow-y-auto'
        : 'w-full max-w-[400px] bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg relative'}
    >
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('close')}
              className="absolute right-2 top-2 md:right-4 md:top-4 flex h-11 w-11 items-center justify-center md:h-auto md:w-auto md:p-2 text-text-main/60 hover:text-text-main transition-colors rounded-lg"
            >
              <X size={18} />
            </button>
          )}

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
            {isMigrate && t('enc_migrate_title')}
          </h2>
          <p className="text-sm text-text-main/60 mb-4">
            {isRecovering && t('enc_recovery_subtitle')}
            {!isRecovering && isUnlock && (
              isAutoCreated
                ? (unlockFailed ? t('enc_unlock_subtitle_account_password_changed') : t('enc_unlock_subtitle_account_password'))
                : t('enc_unlock_subtitle')
            )}
            {isSetup && t('enc_setup_subtitle')}
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
            <div className="p-3 rounded-lg bg-accent-warning/10 border border-accent-warning/20 text-accent-warning text-xs mb-3 flex gap-2">
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
                className={`font-mono ${FIELD} uppercase`}
                required
              />
            )}

            {!isRecovering && isMigrate && (
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={isMigrate ? t('enc_migrate_current_password') : t('enc_current_password')}
                aria-label={isMigrate ? t('enc_migrate_current_password') : t('enc_current_password')}
                className={FIELD}
                required
                autoFocus={isMigrate}
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
                  ? (isAutoCreated
                      ? (unlockFailed ? t('enc_previous_or_current_password_placeholder') : t('enc_account_password_placeholder'))
                      : '••••••••')
                  : t('enc_new_password_placeholder')
              }
              aria-label={isUnlock && !isRecovering ? t('unlock_title') : t('enc_new_password_placeholder')}
              className={FIELD}
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
                className={FIELD}
                required
                minLength={MIN_PASSWORD_LENGTH}
              />
            )}

            {!isRecovering && isUnlock && (
              <label className="flex min-h-11 md:min-h-0 items-center gap-2.5 px-1 cursor-pointer select-none text-sm text-text-main/70">
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
                busy ||
                !password ||
                (isRecovering && (!recoveryCode || !confirmPassword)) ||
                (!isUnlock && !confirmPassword)
              }
              className="w-full min-h-11 md:min-h-0 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors flex items-center justify-center gap-2 bg-[var(--brand-primary)]"
            >
              {busy ? (
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
                  className="min-h-11 md:min-h-0 px-3 text-xs text-text-main/60 hover:text-text-main underline transition-colors"
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
        </ModalShell>
  );
}
