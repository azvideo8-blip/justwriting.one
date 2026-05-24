import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Mail, Lock, UserPlus, LogIn, X, ShieldAlert } from 'lucide-react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { useToast } from '../../../shared/components/Toast';
import { MigrationPrompt, checkGuestDocuments } from '../components/MigrationPrompt';
import { deriveMasterKey, generateDataKey, wrapDataKey, unwrapDataKey, setSessionKey, clearSessionKey, toBase64, fromBase64, SALT_LENGTH } from '../../../core/crypto/encrypt';
import { getClient } from '../../../core/firebase/firestoreClient';
import { reportError } from '../../../core/errors/reportError';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';

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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        clearSessionKey();
        return;
      }

      if (onSuccess) {
        onSuccess();
        return;
      }
      const result = await checkGuestDocuments();
      if (result) {
        setMigrationDocCount(result.docs.length);
        setMigrationUserId(u.uid);
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
    setLoading(true);
    setError(null);
    try {
      if (mode === 'register') {
        const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
        const masterKey = await deriveMasterKey(password, salt);
        const dataKey = await generateDataKey();
        const wrappedDataKey = await wrapDataKey(dataKey, masterKey);

        const cred = await createUserWithEmailAndPassword(auth, email, password);

        try {
          const { db, mod } = await getClient();
          const { doc, setDoc } = mod;
          await setDoc(doc(db, 'users', cred.user.uid), {
            encryptionSalt: toBase64(salt),
            encryptedDataKey: wrappedDataKey,
          }, { merge: true });
        } catch (firestoreErr) {
          reportError(firestoreErr, { action: 'saveEncryptionKeys' });
          try {
            sessionStorage.setItem(`pending_keys_${cred.user.uid}`, JSON.stringify({
              encryptionSalt: toBase64(salt),
              encryptedDataKey: wrappedDataKey,
            }));
          } catch (storageErr) {
            reportError(storageErr, { action: 'saveEncryptionKeys_fallback', userId: cred.user.uid });
            setError(t('auth_error_encryption_key_save_failed'));
            return;
          }
        }

        setSessionKey(dataKey);
        setEncryptionEnabled(cred.user.uid, true);
      } else {
        await signInWithEmailAndPassword(auth, email, password);

        const { db, mod } = await getClient();
        const { doc, getDoc, setDoc } = mod;
        const profileSnap = await getDoc(doc(db, 'users', auth.currentUser!.uid));
        if (profileSnap.exists()) {
          const profileData = profileSnap.data();
          if (profileData.encryptionSalt && profileData.encryptedDataKey) {
            const salt = fromBase64(profileData.encryptionSalt as string);
            const masterKey = await deriveMasterKey(password, salt);
            try {
              const dataKey = await unwrapDataKey(profileData.encryptedDataKey as string, masterKey);
              setSessionKey(dataKey);
              setEncryptionEnabled(auth.currentUser!.uid, true);
            } catch (e) {
              if (e instanceof DOMException && e.name === 'OperationError') {
                setError(t('auth_error_wrong_password_encrypted'));
                setLoading(false);
                return;
              }
              throw e;
            }
          } else {
            const pendingRaw = sessionStorage.getItem(`pending_keys_${auth.currentUser!.uid}`);
            if (pendingRaw) {
              try {
                const keys = JSON.parse(pendingRaw);
                await setDoc(doc(db, 'users', auth.currentUser!.uid), keys, { merge: true });
                sessionStorage.removeItem(`pending_keys_${auth.currentUser!.uid}`);
                const salt = fromBase64(keys.encryptionSalt);
                const masterKey = await deriveMasterKey(password, salt);
                const dataKey = await unwrapDataKey(keys.encryptedDataKey, masterKey);
                setSessionKey(dataKey);
                setEncryptionEnabled(auth.currentUser!.uid, true);
              } catch (repairErr) {
                reportError(repairErr, { action: 'repairEncryptionKeys' });
                setEncryptionEnabled(auth.currentUser!.uid, false);
              }
            } else {
              setEncryptionEnabled(auth.currentUser!.uid, false);
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
      {isModal && (onClose || onSuccess) && (
        <button onClick={onClose || onSuccess} className="self-end mb-4 p-2 rounded-lg text-text-main/40 hover:text-text-main transition-colors">
          <X size={20} />
        </button>
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
            <p className="text-lg leading-relaxed text-text-main/50">
              {t('auth_subtitle')}
            </p>
          )}
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            role="alert"
            aria-live="assertive"
            className="p-4 rounded-xl flex items-center gap-3 text-sm text-left border bg-red-500/10 border-red-500/30 text-red-400"
          >
            <AlertCircle size={20} className="shrink-0" />
            <div className="break-words">{error}</div>
          </motion.div>
        )}

        <div className="p-8 rounded-3xl shadow-xl space-y-6 border bg-surface-card border-border-subtle backdrop-blur-2xl">
          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="space-y-2 text-left">
              <label className="text-xs font-bold uppercase tracking-widest ml-1 text-text-main/50">{t('auth_email')}</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-text-main/40" size={18} />
                <input 
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('auth_email_placeholder')}
                  className="w-full pl-12 pr-4 py-3 rounded-xl outline-none transition-colors bg-surface-base/5 border border-border-subtle text-text-main focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
                />
              </div>
            </div>

            <div className="space-y-2 text-left">
              <label className="text-xs font-bold uppercase tracking-widest ml-1 text-text-main/50">{t('auth_password')}</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-text-main/40" size={18} />
                <input 
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-4 py-3 rounded-xl outline-none transition-colors bg-surface-base/5 border border-border-subtle text-text-main focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
                />
              </div>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold hover:brightness-110 active:scale-[0.98] transition-colors disabled:opacity-50 text-white" style={{ background: 'var(--brand-primary)' }}
            >
              {loading ? (
                <div className="w-5 h-5 border-2 rounded-full animate-spin border-white/20 border-t-white" />
              ) : (
                mode === 'login' ? <LogIn size={18} /> : <UserPlus size={18} />
              )}
              {mode === 'login' ? t('auth_sign_in') : t('auth_sign_up')}
            </button>
          </form>

          <button 
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-sm font-medium transition-colors text-text-main/50 hover:text-text-main"
          >
            {mode === 'login' ? t('auth_no_account') : t('auth_has_account')}
          </button>

          {mode === 'login' && (
            <button
              type="button"
              onClick={() => { setForgotEmail(email); setShowForgotPassword(true); setForgotSent(false); setForgotError(null); }}
              className="text-xs transition-colors text-text-main/30 hover:text-text-main/50"
            >
              {t('auth_forgot_password')}
            </button>
          )}
        </div>

        {showForgotPassword && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-surface-base/80 backdrop-blur-sm flex items-center justify-center p-4"
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
              <p className="text-sm text-text-main/50 mb-4">{t('auth_forgot_warning')}</p>

              {forgotSent ? (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
                  {t('auth_forgot_sent')}
                </div>
              ) : (
                <>
                  {forgotError && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-3">{forgotError}</div>
                  )}
                  <div className="space-y-2 text-left mb-3">
                    <input
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder={t('auth_email_placeholder')}
                      className="w-full px-4 py-3 rounded-xl outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
                    />
                  </div>
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400 mb-3">
                    {t('auth_forgot_password_encryption_warning')}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!forgotEmail) return;
                        setForgotLoading(true);
                        setForgotError(null);
                        try {
                          await sendPasswordResetEmail(auth, forgotEmail);
                          setForgotSent(true);
                         } catch (err: unknown) {
                           reportError(err, { action: 'sendPasswordReset' });
                           const fe = err as { code?: string };
                          setForgotError(fe.code === 'auth/user-not-found' ? t('auth_error_user_not_found') : t('auth_error_generic'));
                        } finally {
                          setForgotLoading(false);
                        }
                      }}
                      disabled={forgotLoading || !forgotEmail}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors"
                      style={{ background: 'var(--brand-primary)' }}
                    >
                      {forgotLoading ? <div className="w-4 h-4 border-2 rounded-full animate-spin border-white/20 border-t-white mx-auto" /> : t('auth_forgot_confirm_anyway')}
                    </button>
                    <button
                      onClick={() => setShowForgotPassword(false)}
                      className="px-4 py-2.5 rounded-xl text-sm text-text-main/40 hover:text-text-main/60 transition-colors"
                    >
                      {t('writing_cancel')}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}

        {!isModal && (
          <p className="text-sm text-text-main/40">
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
