import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { updateUserPassword, onPasswordRecovery, verifyOtpForRecovery, getCurrentUser } from '../../../core/auth/supabaseAuthProvider';
import { reportError } from '../../../shared/errors/reportError';

const MIN_PASSWORD_LENGTH = 8;

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
  const isInvite = searchParams.get('type') === 'invite';
  const [legacyInviteHash] = useState(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      return hash.includes('access_token=') && hash.includes('type=invite');
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
      verifyOtpForRecovery(tokenHash, type)
        .then(() => {
          setRecoveryMode(true);
          setLinkExpired(false);
          const currentUserEmail = getCurrentUser()?.email;
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
  }, [searchParams]);

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

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">{isInvite ? 'Задайте пароль' : 'Восстановление пароля'}</h1>

        {legacyInviteHash && !done && (
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

        {!legacyInviteHash && linkExpired && !done && (
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

        {!recoveryMode && !done && !linkExpired && (
          <p className="text-sm opacity-70">
            Откройте эту страницу по ссылке из письма. Если вы перешли напрямую —
            запросите восстановление пароля на странице входа.
          </p>
        )}

        {recoveryMode && !done && (
          <form onSubmit={e => { void submit(e); }} className="space-y-3">
            {!isInvite && (
              <div className="p-3 rounded-lg bg-accent-warning/10 border border-accent-warning/30 text-accent-warning text-xs leading-relaxed">
                <strong>Важно:</strong> смена пароля аккаунта не меняет пароль шифрования заметок.
                Если вы не сохранили код восстановления шифрования, доступ к облачным заметкам на
                других устройствах будет потерян. Код восстановления можно было увидеть при
                первоначальной настройке шифрования или в разделе Настройки → Безопасность.
              </div>
            )}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Новый пароль"
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
              autoComplete="new-password"
              required
              className="w-full rounded-lg border px-3 py-2 bg-transparent"
            />
            {error && <p className="text-sm text-accent-danger">{error}</p>}
            <button
              type="submit"
              disabled={busy || password.length < MIN_PASSWORD_LENGTH}
              className="w-full rounded-lg px-3 py-2 bg-accent text-white disabled:opacity-50"
            >
              {busy ? 'Сохраняю…' : isInvite ? 'Задать пароль' : 'Сменить пароль'}
            </button>
          </form>
        )}

        {done && (
          <div className="space-y-3">
            <p className="text-sm">{isInvite ? 'Пароль задан. Теперь можно войти.' : 'Пароль изменён. Войдите с новым паролем.'}</p>
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
