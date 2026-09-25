import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Download, Check } from 'lucide-react';
import { updateUserPassword } from '../../../core/auth/supabaseAuthProvider';
import { AuthService } from '../services/AuthService';
import { PrivacyConsentBody, savePrivacyConsent } from './PrivacyConsentBody';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { MIN_PASSWORD_LENGTH } from '../../../shared/constants/passwordPolicy';
import { reportError } from '../../../shared/errors/reportError';

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
type Step = 'welcome' | 'policy' | 'password' | 'sync';
const NUMBERED: Step[] = ['policy', 'password', 'sync'];

export function InviteWizard({ email }: { email: string | null }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('welcome');
  const [policy, setPolicy] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [codeSaved, setCodeSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Минимум ${MIN_PASSWORD_LENGTH} символов`);
    if (password !== confirm) return setError('Пароли не совпадают');
    if (!email) return setError('Не удалось узнать адрес из ссылки — откройте ссылку из письма ещё раз.');
    setBusy(true);
    try {
      await updateUserPassword(password);
      const { user } = await AuthService.signInWithEmail(email, password);
      await savePrivacyConsent(user.uid, aiConsent);
      setUid(user.uid);
      setStep('sync');
    } catch (err) {
      reportError(err, { action: 'inviteWizard_password' });
      setError(typeof navigator !== 'undefined' && !navigator.onLine
        ? 'Нет соединения с сетью. Проверьте подключение и попробуйте снова.'
        : 'Не удалось задать пароль. Ссылка могла устареть — попросите новое приглашение.');
    } finally {
      setBusy(false);
    }
  };

  const takeRecoveryCode = (): string | null => {
    if (!uid) return null;
    try { return sessionStorage.getItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(uid)); } catch { return null; }
  };

  const finish = (syncOn: boolean) => {
    if (uid) {
      try {
        localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(uid), syncOn ? 'true' : 'false');
        localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ASKED(uid), 'true');
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
    try { await navigator.clipboard.writeText(recoveryCode); setCopied(true); } catch { /* ignore */ }
  };

  const downloadCode = () => {
    if (!recoveryCode) return;
    const blob = new Blob([`Код восстановления justwriting\n\n${recoveryCode}\n\nОн нужен, если забудете пароль: без него зашифрованные заметки не открыть.\n`], { type: 'text/plain;charset=utf-8' });
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
              Шаг {stepNo + 1} из {NUMBERED.length}
            </span>
          )}
        </div>

        <div className="p-6 sm:p-8 rounded-3xl border bg-surface-card border-border-subtle shadow-xl space-y-5">
          {step === 'welcome' && (
            <>
              <h1 className="text-2xl font-bold text-text-main">Добро пожаловать в justwriting</h1>
              <p className="text-sm leading-relaxed text-text-main/70">
                Спасибо, что решили попробовать мой проект. Это тихий редактор для свободного письма:
                пишете без оглядки, заметки хранятся у вас и шифруются, а ИИ помогает перечитать
                написанное — только когда вы сами его позовёте.
              </p>
              <p className="text-sm leading-relaxed text-text-main/70">
                Сейчас пройдём три коротких шага, прежде чем начать{email ? <> — для <strong className="text-text-main">{email}</strong></> : null}.
              </p>
              <Primary onClick={() => setStep('policy')}>Начать</Primary>
            </>
          )}

          {step === 'policy' && (
            <>
              <h1 className="text-xl font-bold text-text-main">Как мы обращаемся с данными</h1>
              <PrivacyConsentBody checked={policy} onChecked={setPolicy} aiConsent={aiConsent} onAiConsent={setAiConsent} />
              <Nav onBack={() => setStep('welcome')} onNext={() => setStep('password')} nextDisabled={!policy} />
            </>
          )}

          {step === 'password' && (
            <form onSubmit={e => { void submitPassword(e); }} className="space-y-4">
              <h1 className="text-xl font-bold text-text-main">Придумайте пароль</h1>
              {email && (
                <p className="text-sm text-text-main/70">Ваш логин: <strong className="text-text-main">{email}</strong></p>
              )}
              <p className="text-sm leading-relaxed text-text-main/70">
                Пароль нужен, чтобы входить, — и им же шифруются ваши заметки: без него их не прочитает
                никто, даже мы. Хранить заметки в облаке или только на этом устройстве, решите на
                следующем шаге.
              </p>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Пароль" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required
                className="w-full rounded-xl border border-border-subtle bg-surface-base/5 px-4 py-3 text-text-main outline-none focus:ring-2 focus:ring-[var(--brand-soft)]/40" />
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="Повторите пароль" autoComplete="new-password" required
                className="w-full rounded-xl border border-border-subtle bg-surface-base/5 px-4 py-3 text-text-main outline-none focus:ring-2 focus:ring-[var(--brand-soft)]/40" />
              {error && <p className="text-sm text-accent-danger">{error}</p>}
              <Nav onBack={() => setStep('policy')} nextType="submit" nextLabel={busy ? 'Сохраняю…' : 'Далее'}
                nextDisabled={busy || password.length < MIN_PASSWORD_LENGTH} />
            </form>
          )}

          {step === 'sync' && !recoveryCode && (
            <>
              <h1 className="text-xl font-bold text-text-main">Хранить заметки в облаке?</h1>
              <p className="text-sm leading-relaxed text-text-main/70">
                С синхронизацией заметки попадают на наш сервер в зашифрованном виде — их можно открыть
                на другом устройстве, и они не пропадут вместе с этим. Без неё заметки живут только в
                этом браузере.
              </p>
              <p className="text-xs text-text-main/50">Решение можно поменять в любой момент: Настройки → Синхронизация.</p>
              <div className="grid grid-cols-2 gap-3">
                <Secondary onClick={() => finish(false)}>Не сейчас</Secondary>
                <Primary onClick={enableSync}>Включить</Primary>
              </div>
            </>
          )}

          {step === 'sync' && recoveryCode && (
            <>
              <h1 className="text-xl font-bold text-text-main">Сохраните код восстановления</h1>
              <p className="text-sm leading-relaxed text-text-main/70">
                Если забудете пароль, этот код — единственный способ открыть заметки из облака. Мы его
                не храним и показываем один раз.
              </p>
              <div className="p-4 rounded-2xl bg-surface-base border border-border-subtle text-center font-mono text-base font-bold tracking-wider text-text-main select-all break-all">
                {recoveryCode}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Secondary onClick={() => void copyCode()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Скопировано' : 'Скопировать'}</Secondary>
                <Secondary onClick={downloadCode}><Download size={14} />Скачать</Secondary>
              </div>
              <label className="flex items-start gap-3 cursor-pointer text-left">
                <input type="checkbox" checked={codeSaved} onChange={e => setCodeSaved(e.target.checked)} className="mt-0.5 accent-brand-soft shrink-0" />
                <span className="text-xs text-text-main/70">Я сохранил(а) код в надёжном месте</span>
              </label>
              <Primary onClick={() => finish(true)} disabled={!codeSaved}>Начать писать</Primary>
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

function Nav({ onBack, onNext, nextDisabled, nextType = 'button', nextLabel = 'Далее' }: {
  onBack: () => void; onNext?: (() => void) | undefined; nextDisabled?: boolean | undefined; nextType?: 'button' | 'submit'; nextLabel?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 pt-1">
      <Secondary onClick={onBack}>Назад</Secondary>
      <Primary type={nextType} onClick={onNext} disabled={nextDisabled}>{nextLabel}</Primary>
    </div>
  );
}
