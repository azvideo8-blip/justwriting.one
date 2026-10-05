import { useState, useEffect, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Download, Check } from 'lucide-react';
import { updateUserPassword, getCurrentUser } from '../../../core/auth/supabaseAuthProvider';
import { AuthService } from '../services/AuthService';
import { PrivacyConsentBody, savePrivacyConsent } from './PrivacyConsentBody';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { setCloudSyncEnabled } from '../../../core/sync/cloudSyncEnabled';
import { MIN_PASSWORD_LENGTH } from '../../../shared/constants/passwordPolicy';
import { reportError } from '../../../shared/errors/reportError';
import { useLanguage } from '../../../shared/i18n';
import { passwordErrorKind, type PasswordErrorKind } from '../utils/passwordErrorKind';
import { clearWizardSnapshot, loadWizardSnapshot, saveWizardSnapshot, type WizardStep } from '../utils/inviteWizardState';

/**
 * ON-1/ON-2: мастер приглашения. Приветствие → политика → пароль →
 * синхронизация → редактор, и больше ни одного окна поверх.
 *
 * Пароль задаётся по сессии из ссылки, после чего сразу обычный вход
 * (signInWithEmail): он тихо создаёт сейф из пароля, как при первом входе. Без
 * этого приложение видело вход без сейфа и само предлагало «задайте пароль
 * шифрования». Согласие пишется тем же способом, что в окне при первом входе, —
 * поэтому то окно после мастера не появляется.
 */
type Step = WizardStep;

// V-1.3: kinds считаются общим хелпером (там же и почему), здесь только подписи.
const ERROR_KEY: Record<PasswordErrorKind, 'invite_wizard_err_offline' | 'invite_wizard_err_session_lost' | 'invite_wizard_err_failed'> = {
  offline: 'invite_wizard_err_offline',
  session_lost: 'invite_wizard_err_session_lost',
  failed: 'invite_wizard_err_failed',
};
const NUMBERED: Step[] = ['policy', 'password', 'sync'];

export function InviteWizard({ email, tokenHash = null }: { email: string | null; tokenHash?: string | null }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  // V-1.1: этот запуск мастера мог начаться до перезагрузки страницы — продолжаем
  // с того же шага и с теми же галочками. Шаг «синхронизация» без uid восстанавливать
  // нельзя (uid берём из сессии), тогда — обратно на шаг пароля.
  const [snapshot] = useState(() => loadWizardSnapshot(tokenHash));
  const [restoredUid] = useState<string | null>(() => {
    if (snapshot?.step !== 'sync') return null;
    const uid = getCurrentUser()?.uid ?? null;
    return uid && !uid.startsWith('guest') ? uid : null;
  });
  const [step, setStep] = useState<Step>(() => {
    if (!snapshot) return 'welcome';
    return snapshot.step === 'sync' && !restoredUid ? 'password' : snapshot.step;
  });
  const [policy, setPolicy] = useState(() => snapshot?.policy ?? false);
  const [aiConsent, setAiConsent] = useState(() => snapshot?.aiConsent ?? false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(restoredUid);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [codeSaved, setCodeSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    saveWizardSnapshot(tokenHash, { step, policy, aiConsent });
  }, [tokenHash, step, policy, aiConsent]);

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) return setError(t('invite_wizard_err_min_chars', { count: MIN_PASSWORD_LENGTH }));
    if (password !== confirm) return setError(t('invite_wizard_err_mismatch'));
    if (!email) return setError(t('invite_wizard_err_no_email'));
    setBusy(true);
    try {
      await updateUserPassword(password);
      const { user } = await AuthService.signInWithEmail(email, password);
      await savePrivacyConsent(user.uid, aiConsent);
      setUid(user.uid);
      setStep('sync');
    } catch (err) {
      reportError(err, { action: 'inviteWizard_password' });
      setError(t(ERROR_KEY[passwordErrorKind(err)]));
    } finally {
      setBusy(false);
    }
  };

  const takeRecoveryCode = (): string | null => {
    if (!uid) return null;
    try { return sessionStorage.getItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(uid)); } catch { return null; }
  };

  const finish = (syncOn: boolean) => {
    clearWizardSnapshot(tokenHash);
    if (uid) {
      setCloudSyncEnabled(uid, syncOn);
      try {
        // Код показан здесь (или сознательно не показан) — отдельное окно с ним
        // после мастера не нужно. Новый код можно выпустить в настройках.
        sessionStorage.removeItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(uid));
        localStorage.removeItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(uid));
      } catch { /* private mode */ }
    }
    void navigate('/', { replace: true });
  };

  const enableSync = () => {
    const code = takeRecoveryCode();
    if (code) setRecoveryCode(code);
    else finish(true);
  };

  const copyCode = async () => {
    if (!recoveryCode) return;
    try { await navigator.clipboard.writeText(recoveryCode); setCopied(true); } catch { /* намеренно: доступ к буферу обмена может быть запрещён */ }
  };

  const downloadCode = () => {
    if (!recoveryCode) return;
    const blob = new Blob([t('invite_wizard_download_file_content', { recoveryCode })], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'justwriting-recovery-code.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const stepNo = NUMBERED.indexOf(step);

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 py-10 bg-surface-base">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-3">
          <JustWritingLogo size={36} variant="dark" className="rounded-xl" />
          <span className="text-sm font-semibold text-text-main/70">justwriting</span>
          {stepNo >= 0 && (
            <span className="ml-auto text-xs font-medium text-text-main/50" data-testid="invite-step">
              {t('invite_wizard_step', { current: stepNo + 1, total: NUMBERED.length })}
            </span>
          )}
        </div>

        <div className="p-6 sm:p-8 rounded-3xl border bg-surface-card border-border-subtle shadow-xl space-y-5">
          {step === 'welcome' && (
            <>
              <h1 className="text-2xl font-bold text-text-main">{t('invite_wizard_welcome_title')}</h1>
              <p className="text-sm leading-relaxed text-text-main/70">
                {t('invite_wizard_welcome_desc')}
              </p>
              <p className="text-sm leading-relaxed text-text-main/70">
                {t('invite_wizard_welcome_prompt')}{email ? <> {t('invite_wizard_for_email_prefix')} <strong className="text-text-main">{email}</strong></> : null}.
              </p>
              <Primary onClick={() => setStep('policy')}>{t('invite_wizard_btn_start')}</Primary>
            </>
          )}

          {step === 'policy' && (
            <>
              <h1 className="text-xl font-bold text-text-main">{t('invite_wizard_policy_title')}</h1>
              <PrivacyConsentBody checked={policy} onChecked={setPolicy} aiConsent={aiConsent} onAiConsent={setAiConsent} />
              <Nav onBack={() => setStep('welcome')} onNext={() => setStep('password')} nextDisabled={!policy} />
            </>
          )}

          {step === 'password' && (
            <form onSubmit={e => { void submitPassword(e); }} className="space-y-4">
              <h1 className="text-xl font-bold text-text-main">{t('invite_wizard_password_title')}</h1>
              {email && (
                <p className="text-sm text-text-main/70">{t('invite_wizard_login_label')} <strong className="text-text-main">{email}</strong></p>
              )}
              <p className="text-sm leading-relaxed text-text-main/70">
                {t('invite_wizard_password_desc')}
              </p>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={t('invite_wizard_password_placeholder')} aria-label={t('invite_wizard_password_placeholder')} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required
                className="w-full rounded-xl border border-border-subtle bg-surface-base/5 px-4 py-3 text-text-main outline-none focus:ring-2 focus:ring-[var(--brand-soft)]/40" />
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder={t('invite_wizard_confirm_placeholder')} aria-label={t('invite_wizard_confirm_placeholder')} autoComplete="new-password" required
                className="w-full rounded-xl border border-border-subtle bg-surface-base/5 px-4 py-3 text-text-main outline-none focus:ring-2 focus:ring-[var(--brand-soft)]/40" />
              {error && <p role="alert" className="text-sm text-accent-danger">{error}</p>}
              <Nav onBack={() => setStep('policy')} nextType="submit" nextLabel={busy ? t('invite_wizard_saving') : t('invite_wizard_btn_next')}
                nextDisabled={busy || password.length < MIN_PASSWORD_LENGTH} />
            </form>
          )}

          {step === 'sync' && !recoveryCode && (
            <>
              <h1 className="text-xl font-bold text-text-main">{t('invite_wizard_sync_title')}</h1>
              <p className="text-sm leading-relaxed text-text-main/70">
                {t('invite_wizard_sync_desc')}
              </p>
              <p className="text-xs text-text-main/50">{t('invite_wizard_sync_hint')}</p>
              <div className="grid grid-cols-2 gap-3">
                <Secondary onClick={() => finish(false)}>{t('invite_wizard_btn_not_now')}</Secondary>
                <Primary onClick={enableSync}>{t('invite_wizard_btn_enable_sync')}</Primary>
              </div>
            </>
          )}

          {step === 'sync' && recoveryCode && (
            <>
              <h1 className="text-xl font-bold text-text-main">{t('invite_wizard_recovery_title')}</h1>
              <p className="text-sm leading-relaxed text-text-main/70">
                {t('invite_wizard_recovery_desc')}
              </p>
              <div className="p-4 rounded-2xl bg-surface-base border border-border-subtle text-center font-mono text-base font-bold tracking-wider text-text-main select-all break-all">
                {recoveryCode}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Secondary onClick={() => void copyCode()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? t('invite_wizard_copied') : t('invite_wizard_copy')}</Secondary>
                <Secondary onClick={downloadCode}><Download size={14} />{t('invite_wizard_download')}</Secondary>
              </div>
              <label className="flex items-start gap-3 cursor-pointer text-left">
                <input type="checkbox" checked={codeSaved} onChange={e => setCodeSaved(e.target.checked)} className="mt-0.5 accent-brand-soft shrink-0" />
                <span className="text-xs text-text-main/70">{t('invite_wizard_saved_checkbox')}</span>
              </label>
              <Primary onClick={() => finish(true)} disabled={!codeSaved}>{t('invite_wizard_btn_start_writing')}</Primary>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Primary({ children, onClick, disabled, type = 'button' }: { children: ReactNode; onClick?: (() => void) | undefined; disabled?: boolean | undefined; type?: 'button' | 'submit' }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className="w-full py-3 rounded-xl font-bold text-sm text-surface-base bg-brand-soft hover:brightness-110 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
      {children}
    </button>
  );
}

function Secondary({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full py-3 rounded-xl text-sm font-medium border border-border-subtle text-text-main/80 hover:text-text-main hover:bg-text-main/5 transition-colors flex items-center justify-center gap-2">
      {children}
    </button>
  );
}

function Nav({ onBack, onNext, nextDisabled, nextType = 'button', nextLabel }: {
  onBack: () => void; onNext?: (() => void) | undefined; nextDisabled?: boolean | undefined; nextType?: 'button' | 'submit'; nextLabel?: string;
}) {
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-2 gap-3 pt-1">
      <Secondary onClick={onBack}>{t('invite_wizard_btn_back')}</Secondary>
      <Primary type={nextType} onClick={onNext} disabled={nextDisabled}>{nextLabel ?? t('invite_wizard_btn_next')}</Primary>
    </div>
  );
}
