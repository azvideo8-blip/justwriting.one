import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, Shield, AlertTriangle, AlertCircle, Loader2, KeyRound, Cloud } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { useToast } from '../../../shared/components/Toast';
import { reportError } from '../../../core/errors/reportError';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import {
  initializeEncryption,
  unlockVault,
  changePassword,
  WrongPasswordError,
} from '../../../core/services/EncryptionService';
import { migrateFromLegacy } from '../../../core/services/LegacyKeyMigration';
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

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (mode !== 'none') {
      setTimeout(() => passwordRef.current?.focus(), 100);
    }
  }, [mode]);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
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
      await initializeEncryption(userId, password);
      showToast(t('enc_setup_success'), 'success');
      setPassword('');
      setConfirmPassword('');
      onDone();
    } catch (err) {
      reportError(err, { action: 'initializeEncryption', userId });
      setError(t('error_generic_action'));
    } finally {
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
      showToast(t('unlock_success'), 'success');
      setPassword('');
      onDone();
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        setError(t('unlock_wrong_password'));
      } else {
        reportError(err, { action: 'unlockVault', userId });
        setError(t('error_generic_action'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t('enc_password_min_length', { min: MIN_PASSWORD_LENGTH }));
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
      await migrateFromLegacy(userId, currentPassword, password);
      showToast(t('enc_migration_success'), 'success');
      setPassword('');
      setConfirmPassword('');
      setCurrentPassword('');
      onDone();
    } catch (err) {
      if (err instanceof Error && err.message === 'LEGACY_MIGRATION_WRONG_PASSWORD') {
        setError(t('enc_migration_wrong_password'));
      } else {
        reportError(err, { action: 'migrateFromLegacy', userId });
        setError(t('error_generic_action'));
      }
    } finally {
      setLoading(false);
    }
  };

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
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-[400px] bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-10 h-10 rounded-2xl bg-brand-soft/10 border border-brand-soft/30 flex items-center justify-center mb-4">
            {isUnlock ? (
              <Lock size={18} className="text-brand-soft" />
            ) : isMigrate ? (
              <KeyRound size={18} className="text-brand-soft" />
            ) : (
              <Shield size={18} className="text-brand-soft" />
            )}
          </div>

          <h2 className="text-base font-medium text-text-main mb-1">
            {isUnlock && t('enc_unlock_title')}
            {isSetup && t('enc_setup_title')}
            {isChange && t('enc_change_title')}
            {isMigrate && t('enc_migrate_title')}
          </h2>
          <p className="text-sm text-text-main/50 mb-4">
            {isUnlock && t('enc_unlock_subtitle')}
            {isSetup && t('enc_setup_subtitle')}
            {isChange && t('enc_change_subtitle')}
            {isMigrate && t('enc_migrate_subtitle')}
          </p>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-3 flex items-center gap-2">
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
            onSubmit={
              isUnlock ? handleUnlock :
              isSetup ? handleSetup :
              isChange ? handleChangePassword :
              handleMigrate
            }
            className="space-y-3"
          >
            {(isChange || isMigrate) && (
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={isMigrate ? t('enc_migrate_current_password') : t('enc_current_password')}
                className="w-full px-4 py-3 rounded-xl outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-brand-soft/40 placeholder:text-text-main/20"
                required
                autoFocus={isChange || isMigrate}
              />
            )}

            <input
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isUnlock ? '••••••••' : t('enc_new_password_placeholder')}
              className="w-full px-4 py-3 rounded-xl outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-brand-soft/40 placeholder:text-text-main/20"
              required
              autoFocus={isUnlock || isSetup}
              minLength={isUnlock ? undefined : MIN_PASSWORD_LENGTH}
            />

            {!isUnlock && (
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('enc_confirm_password')}
                className="w-full px-4 py-3 rounded-xl outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-brand-soft/40 placeholder:text-text-main/20"
                required
                minLength={MIN_PASSWORD_LENGTH}
              />
            )}

            <button
              type="submit"
              disabled={loading || !password || (!isUnlock && !confirmPassword)}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors flex items-center justify-center gap-2"
              style={{ background: 'var(--brand-primary)' }}
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isUnlock ? (
                <Lock size={14} />
              ) : (
                <Shield size={14} />
              )}
              {isUnlock && t('enc_unlock_submit')}
              {isSetup && t('enc_setup_submit')}
              {isChange && t('enc_change_submit')}
              {isMigrate && t('enc_migrate_submit')}
            </button>
          </form>

          {isMigrate && (
            <p className="text-xs text-text-main/30 mt-3 text-center">
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
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-colors text-left"
      >
        <KeyRound size={16} className="text-text-main/40" />
        {t('enc_change_password_btn')}
      </button>
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

