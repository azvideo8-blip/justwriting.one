import React, { useState } from 'react';
import { HardDrive, LogIn, User as UserIcon, Lock, Shield } from 'lucide-react';
import { signOut, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { useTimerStore } from '../../writing/store/useTimerStore';
import { resetAndClear } from '../../writing/store/storeActions';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { useLoginModal } from '../../auth/contexts/LoginModalContext';
import { ProfileService } from '../../profile/services/ProfileService';
import { Section } from './SettingsHelpers';
import { deriveMasterKey, wrapDataKey, unwrapDataKey, setSessionKey, getSessionKey, toBase64, fromBase64, SALT_LENGTH } from '../../../core/crypto/encrypt';
import { encryptAllExistingNotes, type MigrationProgress } from '../../../core/crypto/encryptMigration';
import { getClient } from '../../../core/firebase/firestoreClient';

interface AccountTabProps {
  userId: string;
}

export function AccountTab({ userId }: AccountTabProps) {
  const { t } = useLanguage();
  const [confirmReset, setConfirmReset] = useState(false);
  const { isAuthenticated } = useAuthStatus();
  const { openLoginModal } = useLoginModal();
  const { execute } = useServiceAction();

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [migrationDone, setMigrationDone] = useState(false);

  const handleEncryptAll = async () => {
    if (!getSessionKey()) return;
    setMigrationRunning(true);
    setMigrationDone(false);
    setMigrationProgress(null);
    try {
      const result = await encryptAllExistingNotes(userId, setMigrationProgress);
      setMigrationDone(true);
    } catch (e) {
      console.error('Encryption migration failed:', e);
    } finally {
      setMigrationRunning(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      setPasswordError(t('auth_error_weak_password'));
      return;
    }
    setPasswordLoading(true);
    setPasswordError(null);
    setPasswordSuccess(false);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error('Not authenticated');

      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);

      const { db, mod } = await getClient();
      const { doc, getDoc, setDoc } = mod;
      const profileSnap = await getDoc(doc(db, 'users', user.uid));
      if (!profileSnap.exists() || !profileSnap.data().encryptionSalt || !profileSnap.data().encryptedDataKey) {
        throw new Error('Encryption keys not found');
      }

      const profileData = profileSnap.data();
      const oldSalt = fromBase64(profileData.encryptionSalt as string);
      const oldMasterKey = await deriveMasterKey(currentPassword, oldSalt);
      const dataKey = await unwrapDataKey(profileData.encryptedDataKey as string, oldMasterKey);

      const newSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const newMasterKey = await deriveMasterKey(newPassword, newSalt);
      const newWrappedDataKey = await wrapDataKey(dataKey, newMasterKey);

      await setDoc(doc(db, 'users', user.uid), {
        encryptionSalt: toBase64(newSalt),
        encryptedDataKey: newWrappedDataKey,
      }, { merge: true });

      await updatePassword(user, newPassword);

      setSessionKey(dataKey);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: unknown) {
      const firebaseError = err as { code?: string; message?: string };
      let msg = t('auth_error_generic');
      if (firebaseError.code === 'auth/wrong-password' || firebaseError.code === 'auth/invalid-credential') {
        msg = t('auth_error_wrong_password');
      }
      if (firebaseError.code === 'auth/weak-password') msg = t('auth_error_weak_password');
      setPasswordError(msg);
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="space-y-4 mt-2">
      {isAuthenticated ? (
        <Section title={t('me_tab_account')}>
          <div className="flex items-center gap-4 p-4 rounded-xl border border-border-subtle">
            {auth.currentUser?.photoURL ? (
              <img
                src={auth.currentUser.photoURL}
                alt=""
                className="w-12 h-12 rounded-full object-cover border border-border-subtle"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-12 h-12 rounded-full flex items-center justify-center bg-text-main/10 border border-border-subtle">
                <UserIcon size={24} className="text-text-main/40" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-main truncate">
                {auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || t('common_untitled')}
              </div>
              <div className="text-xs text-text-main/40 truncate">
                {auth.currentUser?.email}
              </div>
            </div>
          </div>
        </Section>
      ) : (
        <Section title={t('me_tab_account')}>
          <div className="flex items-center gap-4 p-4 rounded-xl border border-dashed border-border-subtle">
            <div className="w-12 h-12 rounded-full flex items-center justify-center bg-text-main/10">
              <HardDrive size={24} className="text-text-main/40" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-main/60">
                {t('guest_saved_locally')}
              </div>
              <div className="text-xs text-text-main/30 mt-0.5">
                {t('guest_sync_hint')}
              </div>
            </div>
          </div>
        </Section>
      )}

      {isAuthenticated ? (
        <>
          <button
            onClick={() => {
              const s = useTimerStore.getState();
              if (s.status === 'writing' || s.status === 'paused') {
                if (!window.confirm(t('writing_cancel_confirm'))) return;
                resetAndClear();
              }
              execute(
                () => signOut(auth),
                { errorMessage: t('error_signout_failed') }
              );
            }}
            className="w-full px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-red-400 hover:border-red-400/30 transition-all text-left"
          >
            {t('me_sign_out')}
          </button>

          <Section title={t('settings_change_password')}>
            {!showChangePassword ? (
              <button
                onClick={() => setShowChangePassword(true)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-all text-left"
              >
                <Lock size={16} className="text-text-main/40" />
                {t('settings_change_password')}
              </button>
            ) : (
              <div className="space-y-3 p-4 rounded-xl border border-border-subtle">
                {passwordError && (
                  <div className="p-3 rounded-lg text-xs bg-red-500/10 border border-red-500/30 text-red-400">{passwordError}</div>
                )}
                {passwordSuccess && (
                  <div className="p-3 rounded-lg text-xs bg-green-500/10 border border-green-500/30 text-green-400">{t('settings_password_changed')}</div>
                )}
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={t('settings_current_password')}
                  className="w-full px-4 py-3 rounded-xl outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('settings_new_password')}
                  className="w-full px-4 py-3 rounded-xl outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-[var(--brand-soft)]/40 placeholder:text-text-main/20"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleChangePassword}
                    disabled={passwordLoading}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-all"
                    style={{ background: 'var(--brand-primary)' }}
                  >
                    {passwordLoading ? <div className="w-4 h-4 border-2 rounded-full animate-spin border-white/20 border-t-white mx-auto" /> : t('settings_change_password')}
                  </button>
                  <button
                    onClick={() => { setShowChangePassword(false); setPasswordError(null); setPasswordSuccess(false); }}
                    className="px-4 py-2.5 rounded-xl text-sm text-text-main/40 hover:text-text-main/60 transition-colors"
                  >
                    {t('writing_cancel')}
                  </button>
                </div>
              </div>
            )}
          </Section>

          {getSessionKey() && (
            <Section title={t('settings_encryption')}>
              {!migrationRunning && !migrationDone ? (
                <button
                  onClick={handleEncryptAll}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-all text-left"
                >
                  <Shield size={16} className="text-text-main/40" />
                  {t('settings_encrypt_all')}
                </button>
              ) : migrationRunning ? (
                <div className="p-4 rounded-xl border border-border-subtle space-y-3">
                  <div className="text-sm text-text-main/60">{t('settings_encrypting_progress')}</div>
                  {migrationProgress && (
                    <div className="w-full bg-text-main/10 rounded-full h-2">
                      <div
                        className="bg-[var(--brand-primary)] h-2 rounded-full transition-all"
                        style={{ width: `${migrationProgress.total > 0 ? (migrationProgress.processed / migrationProgress.total * 100) : 0}%` }}
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
            </Section>
          )}
        </>
      ) : (
        <button
          onClick={openLoginModal}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-text-main bg-text-main text-surface-base text-sm font-bold hover:opacity-90 transition-all"
        >
          <LogIn size={16} />
          {t('auth_sign_in')}
        </button>
      )}

      <Section title={t('profile_achievements')}>
        {!confirmReset ? (
          <button
            onClick={() => setConfirmReset(true)}
            className="w-full px-4 py-3 rounded-xl border border-red-400/25 text-sm text-red-400/70 hover:text-red-400 hover:border-red-400/40 transition-all text-left"
          >
            {t('profile_reset_achievements')}
          </button>
        ) : (
          <div className="flex flex-col gap-3 p-4 rounded-xl border border-red-400/20 bg-red-400/5">
            <span className="text-sm text-text-main/70">{t('reset_achievements_confirm')}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => execute(
                  () => ProfileService.resetAchievements(userId),
                  { successMessage: t('save_success'), errorMessage: t('error_generic_action'), onSuccess: () => setConfirmReset(false) }
                )}
                className="px-4 py-2 rounded-xl text-sm font-bold text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-all"
              >
                {t('finish_discard')}
              </button>
              <button onClick={() => setConfirmReset(false)} className="text-sm text-text-main/40 hover:text-text-main/60 transition-colors">
                {t('writing_cancel')}
              </button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
