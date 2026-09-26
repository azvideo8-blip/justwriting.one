import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { updateUserPassword, onPasswordRecovery, verifyOtpForRecovery, getCurrentUser } from '../../../core/auth/supabaseAuthProvider';
import { reportError } from '../../../shared/errors/reportError';
import { MIN_PASSWORD_LENGTH } from '../../../shared/constants/passwordPolicy';
import { InviteWizard } from '../components/InviteWizard';

/**
 * /reset-password — цель ссылки из письма о восстановлении.
 *
 * Сессия восстановления активируется клиентом Supabase автоматически
 * (PKCE-обмен по ?code= или событие PASSWORD_RECOVERY у implicit-ссылок),
 * либо через прямой обмен token_hash при переходе с других устройств.
 * Сейф шифрования к аккаунтному паролю отношения не имеет —
 * трогать useEncryptionStore здесь запрещено.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [recoveryMode, setRecoveryMode] = useState(() => {
    const u = getCurrentUser();
    return Boolean(u && typeof u.uid === 'string' && !u.uid.startsWith('guest'));
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkExpired, setLinkExpired] = useState(false);
  const [email, setEmail] = useState<string | null>(() => searchParams.get('email') || (getCurrentUser()?.email ?? null));
  // Приглашённый задаёт первый пароль — те же поля, другие слова.
  const [isInvite] = useState(() => {
    return searchParams.get('type') === 'invite' || (typeof window !== 'undefined' && window.location.hash.includes('type=invite'));
  });
  // Ссылка-приглашение открыта, когда в браузере уже выполнен вход: сессия в
  // браузере одна, и переход по ссылке выкинул бы из текущего аккаунта молча.
  // Сначала спрашиваем. undefined — ещё не проверили, null — входа не было.
  const [switchFrom, setSwitchFrom] = useState<string | null | undefined>(isInvite ? undefined : null);
  const [switchConfirmed, setSwitchConfirmed] = useState(false);
  const [legacyHash] = useState(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      return hash.includes('access_token=');
    }
    return false;
  });

  useEffect(() => {
    const unsub = onPasswordRecovery(() => {
      setRecoveryMode(true);
      setLinkExpired(false);
      const currentUserEmail = getCurrentUser()?.email;
      if (currentUserEmail) setEmail(currentUserEmail);
    });

    const tokenHash = searchParams.get('token_hash');
    const type = searchParams.get('type');

    if (tokenHash && (type === 'recovery' || type === 'invite')) {
      if (type === 'invite' && !switchConfirmed) {
        void (async () => {
          try {
            const { getSupabase } = await import('../../../core/supabase/client');
            const { data } = await getSupabase().auth.getSession();
            const signedIn = data.session?.user ?? null;
            setSwitchFrom(signedIn ? (signedIn.email ?? 'другой аккаунт') : null);
            if (!signedIn) setSwitchConfirmed(true);
          } catch (e) {
            // N-37: не смогли проверить — не значит «никто не вошёл». Спрашиваем.
            reportError(e, { action: 'inviteSwitch_getSession' });
            setSwitchFrom('');
          }
        })();
        return unsub;
      }
      verifyOtpForRecovery(tokenHash, type)
        .then((linkEmail) => {
          setRecoveryMode(true);
          setLinkExpired(false);
          const currentUserEmail = linkEmail ?? getCurrentUser()?.email;
          if (currentUserEmail) setEmail(currentUserEmail);
          window.history.replaceState(null, '', window.location.pathname);
        })
        .catch((err) => {
          reportError(err, { action: 'verifyOtpRecovery' });
          const activeUser = getCurrentUser();
          if (activeUser && typeof activeUser.uid === 'string' && !activeUser.uid.startsWith('guest')) {
            setRecoveryMode(true);
            setLinkExpired(false);
            if (activeUser.email) setEmail(activeUser.email);
          } else {
            setLinkExpired(true);
          }
          window.history.replaceState(null, '', window.location.pathname);
        });
    }

    return unsub;
  }, [searchParams, switchConfirmed]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Минимум ${MIN_PASSWORD_LENGTH} символов`);
      return;
    }
    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    try {
      let recoveredEmail = email ?? getCurrentUser()?.email ?? null;
      if (!recoveredEmail) {
        try {
          const { getSupabase } = await import('../../../core/supabase/client');
          const { data } = await getSupabase().auth.getUser();
          recoveredEmail = data.user?.email ?? null;
        } catch {
          // ignore
        }
      }
      if (recoveredEmail) setEmail(recoveredEmail);

      await updateUserPassword(password);
      // Полусессия от ссылки восстановления затирается: она ограничена сменой
      // пароля, и оставлять человека залогиненным, не вводившим новый пароль,
      // нельзя.
      const { signOutUser } = await import('../../../core/auth/supabaseAuthProvider');
      await signOutUser().catch(() => {});
      setDone(true);
    } catch (err) {
      reportError(err, { action: 'resetPassword' });
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setError('Нет соединения с сетью. Проверьте подключение и попробуйте снова.');
      } else {
        setError('Не удалось изменить пароль. Ссылка могла устареть — запросите новую.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (isInvite && searchParams.get('token_hash') && !switchConfirmed) {
    if (switchFrom === undefined) {
      return <div className="min-h-screen bg-surface-base"><p role="status" className="sr-only">Проверяю, выполнен ли вход…</p></div>;
    }
    return (
      <div className="min-h-screen w-full flex items-center justify-center px-4 py-10 bg-surface-base">
        {/* N-56: вопрос, после которого человек выходит из аккаунта во всех
            вкладках, — диалог для скринридера, фокус сразу на безопасном «Остаться». */}
        <div role="alertdialog" aria-modal="true" aria-labelledby="invite-switch-title" aria-describedby="invite-switch-desc"
          className="w-full max-w-md p-6 sm:p-8 rounded-3xl border bg-surface-card border-border-subtle shadow-xl space-y-5" data-testid="invite-switch-account">
          <h1 id="invite-switch-title" className="text-xl font-bold text-text-main">{switchFrom ? 'Сейчас выполнен вход в другой аккаунт' : 'Возможно, выполнен вход в другой аккаунт'}</h1>
          <p id="invite-switch-desc" className="text-sm leading-relaxed text-text-main/70">
            {switchFrom
              ? <>В этом браузере открыт аккаунт <strong className="text-text-main">{switchFrom}</strong>. </>
              : <>Не удалось проверить, открыт ли в этом браузере другой аккаунт. </>}
            Приглашение создаёт новый аккаунт, и из текущего придётся выйти — во всех вкладках. Ваши
            заметки и черновик останутся в нём, войти обратно можно в любой момент.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" autoFocus onClick={() => { void navigate('/', { replace: true }); }}
              className="w-full py-3 rounded-xl text-sm font-medium border border-border-subtle text-text-main/80 hover:text-text-main hover:bg-text-main/5 transition-colors">
              Остаться
            </button>
            <button type="button" onClick={() => setSwitchConfirmed(true)}
              className="w-full py-3 rounded-xl font-bold text-sm text-surface-base bg-brand-soft hover:brightness-110 transition-colors">
              Продолжить
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ON-2: приглашённый проходит мастер (приветствие → политика → пароль →
  // синхронизация); голая форма ниже — для сброса пароля.
  if (isInvite && recoveryMode && !linkExpired && !legacyHash) {
    return <InviteWizard email={email} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">{isInvite ? 'Задайте пароль' : 'Восстановление пароля'}</h1>

        {legacyHash && !done && (
          <div className="space-y-3">
            <p className="text-sm text-accent-warning">
              Ссылка из письма имеет устаревший формат (implicit hash). Запросите новую ссылку или откройте её повторно.
            </p>
            <button
              type="button"
              onClick={() => { void navigate('/login'); }}
              className="rounded-lg px-3 py-2 bg-accent text-white text-sm"
            >
              Перейти ко входу
            </button>
          </div>
        )}

        {!legacyHash && linkExpired && !done && (
          <div className="space-y-3">
            <p className="text-sm text-accent-danger">
              Ссылка уже использована или устарела — запросите новую
            </p>
            <button
              type="button"
              onClick={() => { void navigate('/login'); }}
              className="rounded-lg px-3 py-2 bg-accent text-white text-sm"
            >
              Запросить новую ссылку
            </button>
          </div>
        )}

        {!recoveryMode && !done && !linkExpired && !legacyHash && (
          <p className="text-sm opacity-70">
            Откройте эту страницу по ссылке из письма. Если вы перешли напрямую —
            запросите восстановление пароля на странице входа.
          </p>
        )}

        {recoveryMode && !done && !legacyHash && (
          <form onSubmit={e => { void submit(e); }} className="space-y-3">
            <div className="p-3 rounded-lg bg-accent-warning/10 border border-accent-warning/30 text-accent-warning text-xs leading-relaxed">
              {/* D-23/D-28: код восстановления показывается один раз — в настройках его нет. */}
              <strong>Важно:</strong> заметки зашифрованы прежним паролем. После входа с новым паролем
              приложение один раз попросит прежний пароль или код восстановления, который вы сохранили при
              первом входе, — и дальше у вас снова будет один пароль. Без прежнего пароля и кода
              зашифрованные заметки не открыть.
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Новый пароль"
              aria-label="Новый пароль"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              className="w-full rounded-lg border px-3 py-2 bg-transparent"
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Повторите пароль"
              aria-label="Повторите пароль"
              autoComplete="new-password"
              required
              className="w-full rounded-lg border px-3 py-2 bg-transparent"
            />
            {error && <p role="alert" className="text-sm text-accent-danger">{error}</p>}
            <button
              type="submit"
              disabled={busy || password.length < MIN_PASSWORD_LENGTH}
              className="w-full rounded-lg px-3 py-2 bg-accent text-white disabled:opacity-50"
            >
              {busy ? 'Сохраняю…' : 'Сменить пароль'}
            </button>
          </form>
        )}

        {done && (
          <div className="space-y-3">
            <p className="text-sm">Пароль изменён. Войдите с новым паролем.</p>
            <button
              type="button"
              onClick={() => { void navigate('/login', email ? { state: { email } } : undefined); }}
              className="rounded-lg px-3 py-2 bg-accent text-white"
            >
              Перейти ко входу
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
