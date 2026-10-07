import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { AlertCircle, AlertTriangle, Mail, Lock, UserPlus, LogIn, X, ShieldAlert } from 'lucide-react';

import { onAuthStateChange } from '../../../core/auth';
import { MIN_PASSWORD_LENGTH } from '../../../shared/constants/passwordPolicy';
import { AuthService } from '../services/AuthService';
import { useLanguage } from '../../../shared/i18n';
import { SeoHead } from '../../../shared/i18n/SeoHead';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { clearSessionKey } from '../../../core/crypto/encrypt';
import { reportError } from '../../../shared/errors/reportError';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { Input } from '../../../shared/components/Input';
import { ModalShell } from '../../../shared/components/ModalShell';

interface LoginPageProps {
  isModal?: boolean;
  onSuccess?: () => void;
  onClose?: () => void;
}

// Регистрация закрыта: сервис работает в одиночном режиме, на сервере стоит
// DISABLE_SIGNUP=true. Форма без этого флага осталась бы на месте и отвечала
// бы отказом — хуже, чем её отсутствие. Ставить true одновременно с открытием
// регистрации на сервере, не раньше.
const SIGNUP_ENABLED = false;
// Пока регистрация закрыта (тестирование по приглашениям), человеку без
// приглашения показываем, куда написать.
const SIGNUP_CONTACT_URL = 'https://t.me/andreyzubkov';

type SupabaseAuthError = { code?: string; message?: string; status?: number };

/** Коды Supabase Auth (invalid_credentials и т.п.) в текст для человека.
 *  До переезда здесь стояли коды Firebase (`auth/wrong-password`), которые
 *  Supabase не присылает никогда — любая ошибка показывалась как общая. */
export function mapSupabaseAuthError(
  err: unknown,
  t: (key: string) => string,
): string {
  const e = (err ?? {}) as SupabaseAuthError;
  let msg = t('auth_error_generic');
  // SEC-35: Generic unified error for credential failures to prevent user enumeration
  if (e.code === 'invalid_credentials') {
    // Сюда же попадают несуществующий аккаунт и неверный пароль — намеренно.
    msg = t('auth_error_invalid_credential');
  } else if (e.code === 'user_already_exists' || e.code === 'email_exists') {
    msg = t('auth_error_email_in_use');
  } else if (e.code === 'weak_password') {
    msg = t('auth_error_weak_password');
  } else if (e.code === 'email_not_confirmed') {
    msg = t('auth_error_email_not_confirmed');
  }

  if (
    e.status === 429 ||
    e.code === 'over_request_rate_limit' ||
    e.code === 'over_email_send_rate_limit' ||
    e.code === 'too_many_requests'
  ) {
    msg = t('auth_error_rate_limited');
  } else if (e.code === 'request_timeout' || e.code === 'network_error') {
    msg = t('auth_error_network');
  }
  return msg;
}

export function LoginPage({ isModal, onSuccess, onClose }: LoginPageProps) {
  const location = useLocation();
  const locationState = location?.state as { email?: string } | null | undefined;
  const searchParams = new URLSearchParams(location?.search || '');
  const prefilledEmail = locationState?.email || searchParams.get('email') || '';

  const { t } = useLanguage();
  const [error, setError] = useState<React.ReactNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [prevPrefilledEmail, setPrevPrefilledEmail] = useState(prefilledEmail);
  const [email, setEmail] = useState(prefilledEmail);
  const [password, setPassword] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);

  if (prevPrefilledEmail !== prefilledEmail) {
    setPrevPrefilledEmail(prefilledEmail);
    setEmail(prefilledEmail);
  }

  useEffect(() => {
    if (prefilledEmail) {
      passwordRef.current?.focus();
    }
  }, [prefilledEmail]);

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showSignupInfo, setShowSignupInfo] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [ageConfirmed, setAgeConfirmed] = useState(false);

  useEffect(() => {
    if (!resendAt || resendAt <= Date.now()) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [resendAt]);

  const secondsLeft = resendAt ? Math.max(0, Math.ceil((resendAt - now) / 1000)) : 0;

  useEffect(() => {
    const unsub = onAuthStateChange((u) => {
      if (!u) {
        clearSessionKey();
        return;
      }

      if (onSuccess) {
        onSuccess();
        return;
      }
    });
    return unsub;
  }, [onSuccess]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError(t('auth_error_fields_required'));
      return;
    }
    if (mode === 'register' && password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth_error_weak_password') ?? 'Password must be at least 8 characters.');
      return;
    }
    if (mode === 'register' && !ageConfirmed) {
      setError(t('auth_age_required'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (mode === 'register') {
        const user = await AuthService.signUpWithEmail(email, password);

        // V-1: brand-new registration — confirmed no encryption exists yet.
        setEncryptionEnabled(user.uid, false);
      } else {
        await AuthService.signInWithEmail(email, password);
        if (onSuccess) onSuccess();
      }
    } catch (err: unknown) {
      reportError(err, { action: 'emailAuth', mode });
      setError(mapSupabaseAuthError(err, t));
    } finally {
      setLoading(false);
    }
  };

  const startCooldown = () => {
    const currentNow = Date.now();
    setNow(currentNow);
    setResendAt(currentNow + 60_000);
  };

  const handleSendPasswordReset = async () => {
    if (!forgotEmail) return;
    setForgotLoading(true);
    setForgotError(null);
    try {
      await AuthService.sendPasswordReset(forgotEmail);
      setForgotSent(true);
      startCooldown();
    } catch (err: unknown) {
      reportError(err, { action: 'sendPasswordReset' });
      const fe = err as { code?: string; status?: number };
      if (fe.code === 'auth/user-not-found') {
        setForgotSent(true);
        startCooldown();
      } else if (
        fe.status === 429 ||
        fe.code === 'auth/too-many-requests' ||
        fe.code === 'over_request_rate_limit' ||
        fe.code === 'over_email_send_rate_limit' ||
        fe.code === 'too_many_requests'
      ) {
        setForgotError(t('auth_error_rate_limited'));
      } else if (
        fe.code === 'validation_failed' ||
        fe.status === 400 ||
        (err instanceof Error && /invalid format|validate email|invalid email/i.test(err.message))
      ) {
        setForgotError(t('auth_error_invalid_email'));
      } else {
        setForgotError(t('auth_error_generic'));
      }
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className={isModal ? "flex flex-col items-center justify-center px-6 py-8" : "min-h-screen w-full flex flex-col items-center justify-center px-6 overflow-y-auto py-10 bg-surface-base"}>
      {!isModal && <SeoHead
        path="/login"
        titleRu="Вход — justwriting"
        titleEn="Sign in — justwriting"
        descriptionRu="Войди в тихий редактор justwriting, чтобы сохранять заметки в облако и писать каждый день."
        descriptionEn="Sign in to justwriting, a quiet editor. Save notes to the cloud and write every day."
      />}
      {isModal && (onClose || onSuccess) && (
        <IconButton onClick={onClose || onSuccess} className="self-end mb-4 p-2 rounded-lg text-text-main/60 hover:text-text-main transition-colors" label={t('close')} icon={<X size={20} />} />
      )}
      <motion.div 
        initial={{ opacity: 0, transform: "translateY(20px)" }}
        animate={{ opacity: 1, transform: "translateY(0px)" }}
        className="max-w-md w-full text-center space-y-8"
      >
        <div className="space-y-4">
          {!isModal && (
            <JustWritingLogo size={64} variant="dark" className="mx-auto shadow-[0_0_30px_rgba(165,131,232,0.3)] rounded-2xl" />
          )}
          <h1 className={isModal ? "text-2xl font-bold tracking-tight text-text-main" : "text-5xl font-bold tracking-tight text-text-main"}>
            {isModal ? t('auth_sign_in') : 'justwriting.ru'}
          </h1>
          {!isModal && (
            <p className="text-lg leading-relaxed text-text-main/60">
              {t('auth_subtitle')}
            </p>
          )}
        </div>

        {error != null && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            role="alert"
            aria-live="assertive"
            className="p-4 rounded-xl flex items-center gap-3 text-sm text-left border bg-accent-danger/10 border-accent-danger/30 text-accent-danger"
          >
            <AlertCircle size={20} className="shrink-0" />
            <div className="break-words">{error}</div>
          </motion.div>
        )}

        <div className="p-8 rounded-3xl shadow-xl space-y-6 border bg-surface-card border-border-subtle backdrop-blur-2xl">
          <form onSubmit={(e) => { e.preventDefault(); void handleEmailAuth(e); }} className="space-y-4">
            <div className="space-y-2 text-left">
              <label className="text-xs font-bold uppercase tracking-widest ml-1 text-text-main/60">{t('auth_email')}</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-text-main/60" size={18} />
                <Input 
                  type="email"
                  aria-label={t('auth_email')}
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('auth_email_placeholder')}
                  className="pl-12 pr-4 py-3 outline-none transition-colors bg-surface-base/5 border border-border-subtle text-text-main focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/40"
                />
              </div>
            </div>

            <div className="space-y-2 text-left">
              <label className="text-xs font-bold uppercase tracking-widest ml-1 text-text-main/60">{t('auth_password')}</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-text-main/60" size={18} />
                <Input 
                  ref={passwordRef}
                  type="password"
                  aria-label={t('auth_password')}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-12 pr-4 py-3 outline-none transition-colors bg-surface-base/5 border border-border-subtle text-text-main focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/40"
                />
              </div>
            </div>

            {mode === 'register' && (
              <label className="flex items-start gap-3 cursor-pointer text-left">
                <input
                  type="checkbox"
                  checked={ageConfirmed}
                  onChange={e => setAgeConfirmed(e.target.checked)}
                  className="mt-0.5 accent-brand-soft shrink-0"
                />
                <span className="text-xs text-text-main/60">
                  {t('auth_age_confirm')}
                </span>
              </label>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold hover:brightness-110 active:scale-[0.98] transition-colors disabled:opacity-50 text-white bg-[var(--brand-primary)]"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 rounded-full animate-spin border-white/20 border-t-white" />
              ) : (
                mode === 'login' ? <LogIn size={18} /> : <UserPlus size={18} />
              )}
              {mode === 'login' ? t('auth_sign_in') : t('auth_sign_up')}
            </Button>

          {SIGNUP_ENABLED && (
            <Button
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              className="text-sm font-medium transition-colors text-text-main/60 hover:text-text-main"
            >
              {mode === 'login' ? t('auth_no_account') : t('auth_has_account')}
            </Button>
          )}

          {!SIGNUP_ENABLED && mode === 'login' && (
            <Button
              type="button"
              onClick={() => setShowSignupInfo(true)}
              className="text-sm font-medium transition-colors text-text-main/60 hover:text-text-main"
            >
              {t('auth_signup_closed_btn')}
            </Button>
          )}

          {mode === 'login' && (
            <Button
              type="button"
              onClick={() => { setForgotEmail(email); setShowForgotPassword(true); setForgotSent(false); setForgotError(null); }}
              className="text-xs transition-colors text-text-main/60 hover:text-text-main"
            >
              {t('auth_forgot_password')}
            </Button>
          )}
          </form>

        </div>

        {showSignupInfo && (
          <ModalShell
            open
            onClose={() => setShowSignupInfo(false)}
            labelId="signup-closed-title"
            z="critical"
            className="w-full max-w-sm bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg"
          >
            <h3 id="signup-closed-title" className="text-lg font-semibold text-text-main mb-2">{t('auth_signup_closed_title')}</h3>
            <p className="text-sm text-text-main/70 leading-relaxed mb-5">{t('auth_signup_closed_body')}</p>
            <div className="flex flex-col gap-2">
              <a
                href={SIGNUP_CONTACT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-white bg-[var(--brand-primary)] hover:brightness-110 transition-colors"
              >
                {t('auth_signup_closed_telegram')}
              </a>
              <Button
                type="button"
                onClick={() => setShowSignupInfo(false)}
                className="w-full py-2.5 text-sm text-text-main/60 hover:text-text-main transition-colors"
              >
                {t('auth_signup_closed_close')}
              </Button>
            </div>
          </ModalShell>
        )}

        {showForgotPassword && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[var(--z-auth)] bg-surface-base/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowForgotPassword(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-sm bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-10 h-10 rounded-2xl bg-accent-warning/10 border border-accent-warning/30 flex items-center justify-center mb-4">
                <ShieldAlert size={18} className="text-accent-warning" />
              </div>
              <h2 className="text-base font-medium text-text-main mb-2">{t('auth_forgot_title')}</h2>
              <p className="text-sm text-text-main/60 mb-4">{t('auth_forgot_warning')}</p>

              {forgotSent ? (
                <div className="space-y-4">
                  <div className="p-3 rounded-lg bg-accent-success/10 border border-accent-success/20 text-accent-success text-sm">
                    {t('auth_forgot_sent_to', { email: forgotEmail })}
                  </div>

                  {forgotError && (
                    <div className="p-3 rounded-lg bg-accent-danger/10 border border-accent-danger/20 text-accent-danger text-xs">{forgotError}</div>
                  )}

                  <div className="flex flex-col gap-2 pt-1">
                    <Button
                      onClick={() => void handleSendPasswordReset()}
                      disabled={forgotLoading || secondsLeft > 0}
                      className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors bg-[var(--brand-primary)]"
                    >
                      {forgotLoading ? (
                        <div className="w-4 h-4 border-2 rounded-full animate-spin border-white/20 border-t-white mx-auto" />
                      ) : secondsLeft > 0 ? (
                        `${t('auth_forgot_resend')} (${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')})`
                      ) : (
                        t('auth_forgot_resend')
                      )}
                    </Button>

                    <Button
                      onClick={() => {
                        setForgotSent(false);
                        setForgotError(null);
                        setResendAt(null);
                      }}
                      className="text-xs text-text-main/60 hover:text-text-main transition-colors text-center py-1"
                    >
                      {t('auth_forgot_other_email')}
                    </Button>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleSendPasswordReset();
                  }}
                >
                  {forgotError && (
                    <div className="p-3 rounded-lg bg-accent-danger/10 border border-accent-danger/20 text-accent-danger text-xs mb-3">{forgotError}</div>
                  )}
                  <div className="space-y-2 text-left mb-3">
                    <Input
                      type="email"
                      required
                      aria-label={t('auth_email')}
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder={t('auth_email_placeholder')}
                      className="px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/40"
                    />
                  </div>
                  <div className="rounded-xl border border-accent-warning/30 bg-accent-warning/10 p-3 text-sm text-accent-warning mb-3 flex gap-2">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>{t('auth_forgot_password_encryption_warning')}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={forgotLoading || !forgotEmail}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors bg-[var(--brand-primary)]"
                    >
                      {forgotLoading ? <div className="w-4 h-4 border-2 rounded-full animate-spin border-white/20 border-t-white mx-auto" /> : t('auth_forgot_confirm_anyway')}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setShowForgotPassword(false)}
                      className="px-4 py-2.5 rounded-xl text-sm text-text-main/60 hover:text-text-main transition-colors"
                    >
                      {t('writing_cancel')}
                    </Button>
                  </div>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}

        {!isModal && (
          <p className="text-sm text-text-main/60">
            {t('auth_tagline')}
          </p>
        )}
      </motion.div>
    </div>
  );
}
