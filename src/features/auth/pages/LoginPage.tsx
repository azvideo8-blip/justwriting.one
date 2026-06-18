import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, AlertTriangle, Mail, Lock, UserPlus, LogIn, X, ShieldAlert } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';
import { AuthService } from '../services/AuthService';
import { useLanguage } from '../../../shared/i18n';
import { SeoHead } from '../../../shared/i18n/SeoHead';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { useToast } from '../../../shared/components/Toast';
import { MigrationPrompt, checkGuestDocuments } from '../components/MigrationPrompt';
import { clearSessionKey } from '../../../core/crypto/encrypt';
import { getClient } from '../../../core/firebase/firestoreClient';
import { reportError } from '../../../shared/errors/reportError';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { Input } from '../../../shared/components/Input';

interface LoginPageProps {
  isModal?: boolean;
  onSuccess?: () => void;
  onClose?: () => void;
}

export function LoginPage({ isModal, onSuccess, onClose }: LoginPageProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [error, setError] = useState<React.ReactNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [migrationUserId, setMigrationUserId] = useState<string | null>(null);
  const [migrationDocCount, setMigrationDocCount] = useState(0);

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        clearSessionKey();
        return;
      }

      if (onSuccess) {
        onSuccess();
        return;
      }
      void checkGuestDocuments().then(result => {
        if (result) {
          setMigrationDocCount(result.docs.length);
          setMigrationUserId(u.uid);
        }
      });
    });
    return unsub;
  }, [onSuccess]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError(t('auth_error_fields_required'));
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
        const cred = await AuthService.signUpWithEmail(email, password);

        setEncryptionEnabled(cred.user.uid, false);
      } else {
        await AuthService.signInWithEmail(email, password);

        const { db, mod } = await getClient();
        const { doc, getDoc } = mod;
        const currentUid = AuthService.getCurrentUserId();
        if (!currentUid) throw new Error('Not authenticated after sign-in');
        const profileSnap = await getDoc(doc(db, 'users', currentUid));
        if (profileSnap.exists()) {
          const profileData = profileSnap.data();
          const unlocked = await AuthService.unlockVaultFromProfile(profileData, password, currentUid);
          if (!unlocked) {
            const pendingRaw = sessionStorage.getItem(`pending_keys_${currentUid}`);
            if (pendingRaw) {
              try {
                const keys = JSON.parse(pendingRaw);
                const { setDoc } = mod;
                await setDoc(doc(db, 'users', currentUid), keys, { merge: true });
                sessionStorage.removeItem(`pending_keys_${currentUid}`);
                await AuthService.unlockVaultFromPendingKeys(keys, password, currentUid);
              } catch (repairErr) {
                reportError(repairErr, { action: 'repairEncryptionKeys' });
                setEncryptionEnabled(currentUid, false);
              }
            } else {
              setEncryptionEnabled(currentUid, false);
            }
          }
        }
      }
    } catch (err: unknown) {
      reportError(err, { action: 'emailAuth', mode });
      const firebaseError = err as { code?: string; message?: string };
      let msg = t('auth_error_generic');
      if (firebaseError.code === 'auth/user-not-found') msg = t('auth_error_user_not_found');
      if (firebaseError.code === 'auth/wrong-password') msg = t('auth_error_wrong_password');
      if (firebaseError.code === 'auth/email-already-in-use') msg = t('auth_error_email_in_use');
      if (firebaseError.code === 'auth/weak-password') msg = t('auth_error_weak_password');
      if (firebaseError.code === 'auth/invalid-credential') msg = t('auth_error_invalid_credential');
      if (firebaseError.code === 'auth/operation-not-allowed') {
        msg = t('auth_error_operation_not_allowed');
      }
      if (firebaseError.code === 'auth/network-request-failed') {
        msg = t('auth_error_network');
      }
      if (firebaseError.code === 'auth/internal-error') {
        msg = t('auth_error_internal');
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={isModal ? "flex flex-col items-center justify-center px-6 py-8" : "h-screen w-screen flex flex-col items-center justify-center px-6 overflow-y-auto py-10 bg-surface-base"}>
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
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full text-center space-y-8"
      >
        <div className="space-y-4">
          {!isModal && (
            <JustWritingLogo size={64} variant="dark" className="mx-auto shadow-[0_0_30px_rgba(165,131,232,0.3)] rounded-2xl" />
          )}
          <h1 className={isModal ? "text-2xl font-bold tracking-tight text-text-main" : "text-5xl font-bold tracking-tight text-text-main"}>
            {isModal ? t('auth_sign_in') : 'justwriting.one'}
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

          <Button 
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-sm font-medium transition-colors text-text-main/60 hover:text-text-main"
          >
            {mode === 'login' ? t('auth_no_account') : t('auth_has_account')}
          </Button>

          {mode === 'login' && (
            <Button
              type="button"
              onClick={() => { setForgotEmail(email); setShowForgotPassword(true); setForgotSent(false); setForgotError(null); }}
              className="text-xs transition-colors text-text-main/60 hover:text-text-main/60"
            >
              {t('auth_forgot_password')}
            </Button>
          )}
          </form>

        </div>

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
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
                <ShieldAlert size={18} className="text-amber-400" />
              </div>
              <h2 className="text-base font-medium text-text-main mb-2">{t('auth_forgot_title')}</h2>
              <p className="text-sm text-text-main/60 mb-4">{t('auth_forgot_warning')}</p>

              {forgotSent ? (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
                  {t('auth_forgot_sent')}
                </div>
              ) : (
                <>
                  {forgotError && (
                    <div className="p-3 rounded-lg bg-accent-danger/10 border border-accent-danger/20 text-accent-danger text-xs mb-3">{forgotError}</div>
                  )}
                  <div className="space-y-2 text-left mb-3">
                    <Input
                      type="email"
                      aria-label={t('auth_email')}
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder={t('auth_email_placeholder')}
                      className="px-4 py-3 outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/40"
                    />
                  </div>
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400 mb-3 flex gap-2">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>{t('auth_forgot_password_encryption_warning')}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        if (!forgotEmail) return;
                        setForgotLoading(true);
                        setForgotError(null);
                        void AuthService.sendPasswordReset(forgotEmail).then(() => {
                          setForgotSent(true);
                        }).catch((err: unknown) => {
                          reportError(err, { action: 'sendPasswordReset' });
                          const fe = err as { code?: string };
                          setForgotError(fe.code === 'auth/user-not-found' ? t('auth_error_user_not_found') : t('auth_error_generic'));
                        }).finally(() => {
                          setForgotLoading(false);
                        });
                      }}
                      disabled={forgotLoading || !forgotEmail}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors bg-[var(--brand-primary)]"
                    >
                      {forgotLoading ? <div className="w-4 h-4 border-2 rounded-full animate-spin border-white/20 border-t-white mx-auto" /> : t('auth_forgot_confirm_anyway')}
                    </Button>
                    <Button
                      onClick={() => setShowForgotPassword(false)}
                      className="px-4 py-2.5 rounded-xl text-sm text-text-main/60 hover:text-text-main/60 transition-colors"
                    >
                      {t('writing_cancel')}
                    </Button>
                  </div>
                </>
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

      {migrationUserId && migrationDocCount > 0 && (
        <MigrationPrompt
          userId={migrationUserId}
          docCount={migrationDocCount}
          onDone={() => { setMigrationUserId(null); setMigrationDocCount(0); }}
          onCloudSynced={(synced) => showToast(t('migration_synced_cloud', { count: synced }), 'success')}
        />
      )}
    </div>
  );
}
