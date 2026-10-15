import React, { useState, useRef } from 'react';
import { Lock, AlertCircle, Loader2, KeyRound } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import {
  WrongPasswordError,
  WrongRecoveryCodeError,
  unlockVault,
  recoverVaultWithCode,
} from '../../../core/services/EncryptionService';
import { reportError } from '../../../shared/errors/reportError';
import { MIN_PASSWORD_LENGTH } from '../../../shared/constants/passwordPolicy';
import { Button } from '../../../shared/components/Button';
import { Input } from '../../../shared/components/Input';
import { ModalShell } from '../../../shared/components/ModalShell';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';

// MQ-11: поле ≥ 16 px на телефоне, плейсхолдер — `--text-muted` (≥ 4,5:1), как в окне сейфа.
const FIELD = 'px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-base md:text-sm focus:ring-2 focus:ring-brand-soft/40 placeholder:text-text-muted';

interface UnlockPromptProps {
  uid: string;
  onUnlocked: () => void;
  onClose: () => void;
}

export function UnlockPrompt({ uid, onUnlocked, onClose }: UnlockPromptProps) {
  const { t } = useLanguage();
  const isMobile = useLayoutMode().layoutMode === 'mobile';
  const { showToast } = useToast();

  const [isRecovering, setIsRecovering] = useState(false);
  const [password, setPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attemptCountRef = useRef(0);
  const [backoffSeconds, setBackoffSeconds] = useState(0);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || loading || backoffSeconds > 0) return;
    setLoading(true);
    setError(null);

    try {
      await unlockVault(uid, password);
      attemptCountRef.current = 0;
      showToast(t('unlock_success'), 'success');
      onUnlocked();
    } catch (e) {
      if (e instanceof WrongPasswordError) {
        attemptCountRef.current += 1;
        const attempts = attemptCountRef.current;
        if (attempts >= 3) {
          const backoff = Math.min(30, Math.pow(2, attempts - 3) * 2);
          setBackoffSeconds(backoff);
          const interval = setInterval(() => {
            setBackoffSeconds(prev => {
              if (prev <= 1) {
                clearInterval(interval);
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
        }
        setError(t('unlock_wrong_password'));
      } else {
        reportError(e, { action: 'unlockEncryption', uid });
        setError(t('error_generic'));
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
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t('enc_password_min_length', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError(t('enc_passwords_dont_match'));
      return;
    }
    setLoading(true);
    setError(null);

    try {
      await recoverVaultWithCode(uid, recoveryCode, newPassword);
      showToast(t('enc_recovery_success'), 'success');
      onUnlocked();
    } catch (err) {
      if (err instanceof WrongRecoveryCodeError) {
        setError(t('enc_recovery_code_wrong'));
      } else {
        reportError(err, { action: 'recoverVaultWithCode', uid });
        setError(t('error_generic_action'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      labelId="unlock-modal-title"
      z="critical"
      variant={isMobile ? 'sheet' : 'modal'}
      className={isMobile ? 'p-6 overflow-y-auto' : 'w-full max-w-[380px] bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg'}
    >
          <div className="w-10 h-10 rounded-2xl bg-brand-soft/10 border border-brand-soft/30 flex items-center justify-center mb-4">
            {isRecovering ? (
              <KeyRound size={18} className="text-brand-soft" />
            ) : (
              <Lock size={18} className="text-brand-soft" />
            )}
          </div>
          <h2 id="unlock-modal-title" className="text-base font-medium text-text-main mb-1">
            {isRecovering ? t('enc_recovery_title') : t('unlock_title')}
          </h2>
          <p className="text-sm text-text-main/60 mb-4">
            {isRecovering ? t('enc_recovery_subtitle') : t('unlock_subtitle')}
          </p>

          {error && (
            <div role="alert" className="p-3 rounded-lg bg-accent-danger/10 border border-accent-danger/20 text-accent-danger text-xs mb-3 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          {!isRecovering ? (
            <form onSubmit={(e) => { e.preventDefault(); void handleUnlock(e); }} className="space-y-3">
              <Input
                type="password"
                autoFocus
                aria-label={t('unlock_title')}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className={FIELD}
              />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={loading || !password || backoffSeconds > 0}
                  className="flex-1 min-h-11 md:min-h-0 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors flex items-center justify-center gap-2 bg-[var(--brand-primary)]"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={14} />}
                  {backoffSeconds > 0 ? `${backoffSeconds}s...` : t('unlock_submit')}
                </Button>

                <Button
                  type="button"
                  onClick={onClose}
                  className="min-h-11 md:min-h-0 px-4 py-2.5 rounded-xl text-sm text-text-main/60 hover:text-text-main transition-colors"
                >
                  {t('common_cancel')}
                </Button>
              </div>

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
            </form>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void handleRecover(e); }} className="space-y-3">
              <Input
                type="text"
                autoFocus
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                aria-label={t('enc_recovery_code_label')}
                value={recoveryCode}
                onChange={e => setRecoveryCode(e.target.value)}
                placeholder={t('enc_recovery_code_placeholder')}
                className={`font-mono ${FIELD} uppercase`}
                required
              />

              <Input
                type="password"
                aria-label={t('enc_recovery_new_password')}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder={t('enc_recovery_new_password')}
                className={FIELD}
                required
                minLength={8}
              />

              <Input
                type="password"
                aria-label={t('enc_recovery_confirm_password')}
                value={confirmNewPassword}
                onChange={e => setConfirmNewPassword(e.target.value)}
                placeholder={t('enc_recovery_confirm_password')}
                className={FIELD}
                required
                minLength={8}
              />

              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={loading || !recoveryCode || !newPassword || !confirmNewPassword}
                  className="flex-1 min-h-11 md:min-h-0 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors flex items-center justify-center gap-2 bg-[var(--brand-primary)]"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={14} />}
                  {t('enc_recovery_submit')}
                </Button>

                <Button
                  type="button"
                  onClick={() => {
                    setIsRecovering(false);
                    setError(null);
                  }}
                  className="min-h-11 md:min-h-0 px-4 py-2.5 rounded-xl text-sm text-text-main/60 hover:text-text-main transition-colors"
                >
                  {t('enc_recovery_back_to_password')}
                </Button>
              </div>
            </form>
          )}
        </ModalShell>
  );
}
