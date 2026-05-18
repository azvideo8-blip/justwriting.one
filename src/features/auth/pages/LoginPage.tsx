import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Mail, Lock, UserPlus, LogIn, X, ShieldAlert } from 'lucide-react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, EmailAuthProvider, linkWithCredential } from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';
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
        </div>

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
