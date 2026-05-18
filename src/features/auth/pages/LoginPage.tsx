import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Mail, Lock, UserPlus, LogIn, X, ShieldAlert } from 'lucide-react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, EmailAuthProvider, linkWithCredential, sendPasswordResetEmail, signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../../../core/firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { useToast } from '../../../shared/components/Toast';
import { MigrationPrompt, checkGuestDocuments } from '../components/MigrationPrompt';
import { deriveMasterKey, generateDataKey, wrapDataKey, unwrapDataKey, setSessionKey, clearSessionKey, toBase64, fromBase64, SALT_LENGTH } from '../../../core/crypto/encrypt';
import { getClient } from '../../../core/firebase/firestoreClient';

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

  const [showGoogleMigration, setShowGoogleMigration] = useState(false);
  const [googleMigrationEmail, setGoogleMigrationEmail] = useState('');
  const [migrationPassword, setMigrationPassword] = useState('');
  const [migrationLoading, setMigrationLoading] = useState(false);

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  const [googleLoginLoading, setGoogleLoginLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        clearSessionKey();
        return;
      }
      const providerData = u.providerData;
      const hasGoogleProvider = providerData.some(p => p.providerId === 'google.com');
      const hasEmailProvider = providerData.some(p => p.providerId === 'password');

      if (hasGoogleProvider && !hasEmailProvider) {
        setGoogleMigrationEmail(u.email || '');
        setShowGoogleMigration(true);
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

  const handleGoogleMigration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!migrationPassword || migrationPassword.length < 6) {
      setError(t('auth_error_weak_password'));
      return;
    }
    setMigrationLoading(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error('No current user');

      const credential = EmailAuthProvider.credential(user.email, migrationPassword);
      await linkWithCredential(user, credential);

      const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const masterKey = await deriveMasterKey(migrationPassword, salt);
      const dataKey = await generateDataKey();
      const wrappedDataKey = await wrapDataKey(dataKey, masterKey);

      const { db, mod } = await getClient();
      const { doc, setDoc } = mod;
      await setDoc(doc(db, 'users', user.uid), {
        encryptionSalt: toBase64(salt),
        encryptedDataKey: wrappedDataKey,
      }, { merge: true });

      setSessionKey(dataKey);
      setShowGoogleMigration(false);
      if (user.email) {
        localStorage.setItem(`google_migration_done_${user.email}`, '1');
      }
      showToast(t('auth_migration_success'), 'success');

      if (onSuccess) {
        onSuccess();
      }
    } catch (err: unknown) {
      const firebaseError = err as { code?: string; message?: string };
      let msg = t('auth_error_generic');
      if (firebaseError.code === 'auth/email-already-in-use') msg = t('auth_error_email_in_use');
      if (firebaseError.code === 'auth/weak-password') msg = t('auth_error_weak_password');
      setError(msg);
    } finally {
      setMigrationLoading(false);
    }
  };

  const handleGoogleMigrationLogin = async () => {
    setGoogleLoginLoading(true);
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const providerData = user.providerData;
      const hasGoogleProvider = providerData.some(p => p.providerId === 'google.com');
      const hasEmailProvider = providerData.some(p => p.providerId === 'password');

      if (hasGoogleProvider && !hasEmailProvider) {
        setGoogleMigrationEmail(user.email || '');
        setShowGoogleMigration(true);
      } else {
        if (user.email) {
          localStorage.setItem(`google_migration_done_${user.email}`, '1');
        }
        if (onSuccess) {
          onSuccess();
        }
      }
    } catch (err: unknown) {
      const firebaseError = err as { code?: string; message?: string };
      if (firebaseError.code === 'auth/popup-closed-by-user') {
        // user cancelled, no error
      } else if (firebaseError.code === 'auth/network-request-failed') {
        setError(t('auth_error_google_network'));
      } else if (firebaseError.code === 'auth/popup-blocked') {
        setError(t('auth_error_google_popup'));
      } else {
        setError(t('auth_error_generic'));
      }
    } finally {
      setGoogleLoginLoading(false);
    }
  };

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
        const cred = await createUserWithEmailAndPassword(auth, email, password);

        const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
        const masterKey = await deriveMasterKey(password, salt);
        const dataKey = await generateDataKey();
        const wrappedDataKey = await wrapDataKey(dataKey, masterKey);

        const { db, mod } = await getClient();
        const { doc, setDoc } = mod;
        await setDoc(doc(db, 'users', cred.user.uid), {
          encryptionSalt: toBase64(salt),
          encryptedDataKey: wrappedDataKey,
        }, { merge: true });

        setSessionKey(dataKey);
      } else {
        await signInWithEmailAndPassword(auth, email, password);

        const { db, mod } = await getClient();
        const { doc, getDoc } = mod;
        const profileSnap = await getDoc(doc(db, 'users', auth.currentUser!.uid));
        if (profileSnap.exists()) {
          const profileData = profileSnap.data();
          if (profileData.encryptionSalt && profileData.encryptedDataKey) {
            const salt = fromBase64(profileData.encryptionSalt as string);
            const masterKey = await deriveMasterKey(password, salt);
            const dataKey = await unwrapDataKey(profileData.encryptedDataKey as string, masterKey);
            setSessionKey(dataKey);
          }
        }
      }
    } catch (err: unknown) {
      console.error("Email auth error:", err);
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

  if (showGoogleMigration) {
    return (
      <div className={isModal ? "flex flex-col items-center justify-center px-6 py-8" : "h-screen w-screen flex flex-col items-center justify-center px-6 overflow-y-auto py-10 bg-surface-base"}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-6"
        >
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto">
            <ShieldAlert size={24} className="text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-text-main">{t('auth_google_migration_title')}</h2>
          <p className="text-sm text-text-main/60">{t('auth_google_migration_hint')}</p>
          <p className="text-xs text-text-main/40">{googleMigrationEmail}</p>

          {error && (
            <div role="alert" aria-live="assertive" className="p-4 rounded-xl flex items-center gap-3 text-sm text-left border bg-red-500/10 border-red-500/30 text-red-400">
              <AlertCircle size={20} className="shrink-0" />
              <div className="break-words">{error}</div>
            </div>
          )}

          <form onSubmit={handleGoogleMigration} className="space-y-4 p-6 rounded-2xl border bg-surface-card border-border-subtle">
            <div className="space-y-2 text-left">
              <label className="text-xs font-bold uppercase tracking-widest ml-1 text-text-main/50">{t('auth_new_password')}</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-text-main/40" size={18} />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={migrationPassword}
                  onChange={(e) => setMigrationPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-4 py-3 rounded-xl outline-none transition-all bg-surface-base/5 border border-border-subtle text-text-main focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={migrationLoading}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 text-white"
              style={{ background: 'var(--brand-primary)' }}
            >
              {migrationLoading ? <div className="w-5 h-5 border-2 rounded-full animate-spin border-white/20 border-t-white" /> : t('auth_set_password')}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

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
                  className="w-full pl-12 pr-4 py-3 rounded-xl outline-none transition-all bg-surface-base/5 border border-border-subtle text-text-main focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
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
                  className="w-full pl-12 pr-4 py-3 rounded-xl outline-none transition-all bg-surface-base/5 border border-border-subtle text-text-main focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
                />
              </div>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 text-white" style={{ background: 'var(--brand-primary)' }}
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

          {mode === 'login' && (
            <div className="pt-2 border-t border-border-subtle/50">
              <button
                type="button"
                onClick={handleGoogleMigrationLogin}
                disabled={googleLoginLoading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50 text-text-main/50 hover:text-text-main/70 hover:bg-surface-base/5 border border-border-subtle/50"
              >
                {googleLoginLoading ? (
                  <div className="w-4 h-4 border-2 rounded-full animate-spin border-text-main/20 border-t-text-main/50" />
                ) : (
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                )}
                {t('auth_google_migration_login')}
              </button>
              <p className="mt-1.5 text-[11px] text-text-main/25">{t('auth_google_migration_subtitle')}</p>
            </div>
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
                          const fe = err as { code?: string };
                          setForgotError(fe.code === 'auth/user-not-found' ? t('auth_error_user_not_found') : t('auth_error_generic'));
                        } finally {
                          setForgotLoading(false);
                        }
                      }}
                      disabled={forgotLoading || !forgotEmail}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-all"
                      style={{ background: 'var(--brand-primary)' }}
                    >
                      {forgotLoading ? <div className="w-4 h-4 border-2 rounded-full animate-spin border-white/20 border-t-white mx-auto" /> : t('auth_forgot_confirm')}
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
