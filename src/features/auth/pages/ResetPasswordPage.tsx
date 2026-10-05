import { useEffect, useState, useRef, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { updateUserPassword, onPasswordRecovery, verifyOtpForRecovery, getCurrentUser } from '../../../core/auth/supabaseAuthProvider';
import { reportError } from '../../../shared/errors/reportError';
import { MIN_PASSWORD_LENGTH } from '../../../shared/constants/passwordPolicy';
import { InviteWizard } from '../components/InviteWizard';
import { isAccountReloadPending, reloadForAccountChange } from '../../../core/auth/accountReload';
import { passwordErrorKind, type PasswordErrorKind } from '../utils/passwordErrorKind';
import { useLanguage } from '../../../shared/i18n';

// Смена аккаунта перезагружает страницу (accountReload.ts). Две отметки
// переживают эту перезагрузку: ссылка уже обменена (второй обмен ответил бы
// «ссылка устарела») и пароль уже изменён.
const exchangedKey = (hash: string) => `jw_link_exchanged_${hash}`;
const RESET_DONE_KEY = 'jw_password_reset_done';
// 2026-10-05: отметка обмена — в localStorage, а не только в sessionStorage.
// Ссылку из письма часто открывают второй раз — новой вкладкой, где
// sessionStorage пуст. Без общей отметки страница видела «вход есть, ссылка не
// обменена», решала, что вошёл кто-то чужой, выходила из аккаунта самого
// приглашённого и обменивала ссылку повторно — сервер отвечал «использована»,
// и человек оставался без входа и без пароля (прод, 2026-10-05).
const EXCHANGED_TTL_MS = 24 * 60 * 60 * 1000;

// V-1.3: вид ошибки считает общий с мастером приглашения хелпер, здесь только подписи.
const RESET_ERROR_KEY: Record<PasswordErrorKind, 'reset_pw_offline' | 'reset_pw_session_lost' | 'reset_pw_failed'> = {
  offline: 'reset_pw_offline',
  session_lost: 'reset_pw_session_lost',
  failed: 'reset_pw_failed',
};

function markExchanged(hash: string, email: string | null): void {
  try { sessionStorage.setItem(exchangedKey(hash), '1'); } catch { /* намеренно: приватный режим */ }
  try { localStorage.setItem(exchangedKey(hash), JSON.stringify({ at: Date.now(), email })); } catch { /* намеренно: приватный режим */ }
}

/** Ссылка уже обменена в этом браузере? `email` — кому она принадлежала, если известно. */
function readExchanged(hash: string): { email: string | null } | null {
  try {
    const raw = localStorage.getItem(exchangedKey(hash));
    if (raw) {
      const v = JSON.parse(raw) as { at?: unknown; email?: unknown };
      if (typeof v.at === 'number' && Date.now() - v.at < EXCHANGED_TTL_MS) {
        return { email: typeof v.email === 'string' ? v.email : null };
      }
      localStorage.removeItem(exchangedKey(hash));
    }
  } catch { /* намеренно: нет хранилища — смотрим отметку вкладки */ }
  try { if (sessionStorage.getItem(exchangedKey(hash)) === '1') return { email: null }; } catch { /* намеренно */ }
  return null;
}

/** Отметка про эту сессию: нет адреса у отметки или у сессии — не спорим. */
function exchangedFor(hash: string, sessionEmail: string | null): boolean {
  const mark = readExchanged(hash);
  if (!mark) return false;
  return !mark.email || !sessionEmail || mark.email.toLowerCase() === sessionEmail.toLowerCase();
}

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
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Ссылка в адресе ещё не разобрана — кто сейчас вошёл, ничего не значит:
  // это может быть прежний аккаунт, который вот-вот выйдет (иначе мастер
  // приглашения на миг открывался ему, с его адресом). Решает эффект ниже.
  const [linkPending] = useState(() => Boolean(searchParams.get('token_hash')));
  const [recoveryMode, setRecoveryMode] = useState(() => {
    if (linkPending) return false;
    const u = getCurrentUser();
    return Boolean(u && typeof u.uid === 'string' && !u.uid.startsWith('guest'));
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [doneEmail] = useState(() => {
    try {
      const v = sessionStorage.getItem(RESET_DONE_KEY);
      sessionStorage.removeItem(RESET_DONE_KEY);
      return v;
    } catch { return null; }
  });
  const [done, setDone] = useState(doneEmail !== null);
  const [error, setError] = useState<string | null>(null);
  const [linkExpired, setLinkExpired] = useState(false);
  const [email, setEmail] = useState<string | null>(() => doneEmail || searchParams.get('email') || (linkPending ? null : (getCurrentUser()?.email ?? null)));
  // Приглашённый задаёт первый пароль — те же поля, другие слова.
  const [isInvite] = useState(() => {
    return searchParams.get('type') === 'invite' || (typeof window !== 'undefined' && window.location.hash.includes('type=invite'));
  });
  // Ссылка-приглашение открыта, когда в браузере уже выполнен вход: сессия в
  // браузере одна, и переход по ссылке выкинул бы из текущего аккаунта молча.
  // Сначала спрашиваем. undefined — ещё не проверили, null — входа не было.
  const [switchFrom, setSwitchFrom] = useState<string | null | undefined>(isInvite ? undefined : null);
  // Подтверждение запоминается на время вкладки: если страница перезагрузится
  // посреди приглашения, вход уже будет новым аккаунтом — и вопрос «выйти из
  // него?» про самого приглашённого был бы бессмыслицей.
  const inviteConfirmKey = `jw_invite_switch_confirmed_${searchParams.get('token_hash') ?? ''}`;
  const [switchConfirmed, setSwitchConfirmed] = useState(() => {
    try { return sessionStorage.getItem(inviteConfirmKey) === '1'; } catch { return false; }
  });
  const confirmSwitch = () => {
    try { sessionStorage.setItem(inviteConfirmKey, '1'); } catch { /* private mode */ }
    setSwitchConfirmed(true);
  };
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
            // Вошёл тот самый приглашённый — ссылку он уже обменял в этом
            // браузере (например, открыл письмо второй раз). Спрашивать «выйти
            // из аккаунта?» про него самого нельзя: выход сжёг бы ему вход.
            if (signedIn && exchangedFor(tokenHash, signedIn.email ?? null)) {
              setSwitchFrom(null);
              setSwitchConfirmed(true);
              return;
            }
            setSwitchFrom(signedIn ? (signedIn.email ?? 'other') : null);
            if (!signedIn) setSwitchConfirmed(true);
          } catch (e) {
            // N-37: не смогли проверить — не значит «никто не вошёл». Спрашиваем.
            reportError(e, { action: 'inviteSwitch_getSession' });
            setSwitchFrom('');
          }
        })();
        return unsub;
      }
      const exchange = () =>
        verifyOtpForRecovery(tokenHash, type)
          .then((linkEmail) => {
            // Отметка — только после успешного обмена. Поставленная до него,
            // она сбивала повторный запуск эффекта, пока обмен ещё в пути:
            // «обменена, а сессии нет» читалось как «ссылка устарела».
            markExchanged(tokenHash, linkEmail ?? null);
            setRecoveryMode(true);
            setLinkExpired(false);
            const currentUserEmail = linkEmail ?? getCurrentUser()?.email;
            if (currentUserEmail) setEmail(currentUserEmail);
            // Адрес не чистим: обменянный token_hash второй раз не сработает, а
            // перезагрузка на шаге пароля по нему узнаёт «уже обменена» и что
            // это приглашение (иначе вместо мастера — форма восстановления).
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
      void (async () => {
        const { getSupabase } = await import('../../../core/supabase/client');
        let signedIn = false;
        let sessionEmail: string | null = null;
        try {
          const { data } = await getSupabase().auth.getSession();
          signedIn = Boolean(data.session);
          sessionEmail = data.session?.user.email ?? null;
        } catch (e) {
          reportError(e, { action: 'resetLink_getSession' });
        }
        if (exchangedFor(tokenHash, sessionEmail)) {
          // Страница перезагрузилась после обмена: сессия от ссылки уже есть.
          if (signedIn) {
            setRecoveryMode(true);
            if (sessionEmail) setEmail(sessionEmail);
          } else {
            setLinkExpired(true);
            window.history.replaceState(null, '', window.location.pathname);
          }
          return;
        }
        if (signedIn) {
          // Во вкладке кто-то вошёл. Сначала выход — страница перезагрузится
          // и обменяет ссылку уже с чистой памятью, без чужих данных в ней.
          const { signOutUser } = await import('../../../core/auth/supabaseAuthProvider');
          await signOutUser({ scope: 'local' }).catch(e => reportError(e, { action: 'resetLink_signOutFirst' }));
          if (!isAccountReloadPending()) void reloadForAccountChange();
          return;
        }
        await exchange();
      })();
    }

    return unsub;
  }, [searchParams, switchConfirmed]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('reset_pw_min_length', { count: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t('reset_pw_mismatch'));
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
      // Выход перезагрузит страницу — «пароль изменён» покажет уже она.
      try { sessionStorage.setItem(RESET_DONE_KEY, recoveredEmail ?? ''); } catch { /* намеренно: без отметки покажем форму входа */ }
      const { signOutUser } = await import('../../../core/auth/supabaseAuthProvider');
      await signOutUser().catch(() => { /* намеренно: полусессия истечёт сама */ });
      setDone(true);
    } catch (err) {
      reportError(err, { action: 'resetPassword' });
      // V-1.3: тот же маппинг видов ошибки, что у мастера приглашения.
      setError(t(RESET_ERROR_KEY[passwordErrorKind(err)]));
    } finally {
      setBusy(false);
    }
  };

  const stayBtnRef = useRef<HTMLButtonElement>(null);
  const continueBtnRef = useRef<HTMLButtonElement>(null);

  const isSwitchAlertActive = isInvite && Boolean(searchParams.get('token_hash')) && !switchConfirmed && switchFrom !== undefined;

  useEffect(() => {
    if (!isSwitchAlertActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void navigate('/', { replace: true });
        return;
      }

      if (e.key === 'Tab') {
        const stay = stayBtnRef.current;
        const cont = continueBtnRef.current;
        if (!stay || !cont) return;

        if (e.shiftKey) {
          if (document.activeElement === stay || !document.activeElement || !stay.contains(document.activeElement)) {
            e.preventDefault();
            cont.focus();
          }
        } else {
          if (document.activeElement === cont) {
            e.preventDefault();
            stay.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSwitchAlertActive, navigate]);

  if (isInvite && searchParams.get('token_hash') && !switchConfirmed) {
    if (switchFrom === undefined) {
      return <div className="min-h-screen bg-surface-base"><p role="status" className="sr-only">{t('reset_pw_checking_signin')}</p></div>;
    }
    return (
      <div className="min-h-screen w-full flex items-center justify-center px-4 py-10 bg-surface-base">
        {/* N-56: вопрос, после которого человек выходит из аккаунта во всех
            вкладках, — диалог для скринридера, фокус сразу на безопасном «Остаться». */}
        <div role="alertdialog" aria-modal="true" aria-labelledby="invite-switch-title" aria-describedby="invite-switch-desc"
          className="w-full max-w-md p-6 sm:p-8 rounded-3xl border bg-surface-card border-border-subtle shadow-xl space-y-5" data-testid="invite-switch-account">
          <h1 id="invite-switch-title" className="text-xl font-bold text-text-main">{switchFrom ? t('reset_pw_switch_title_signed_in') : t('reset_pw_switch_title_unknown')}</h1>
          <p id="invite-switch-desc" className="text-sm leading-relaxed text-text-main/70">
            {switchFrom
              ? <>{t('reset_pw_switch_desc_account_before')}<strong className="text-text-main">{switchFrom === 'other' ? t('reset_pw_other_account') : switchFrom}</strong>{t('reset_pw_switch_desc_account_after')}</>
              : <>{t('reset_pw_switch_desc_unknown')}</>}
            {t('reset_pw_switch_desc_body')}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button ref={stayBtnRef} type="button" autoFocus onClick={() => { void navigate('/', { replace: true }); }}
              className="w-full py-3 rounded-xl text-sm font-medium border border-border-subtle text-text-main/80 hover:text-text-main hover:bg-text-main/5 transition-colors">
              {t('reset_pw_switch_btn_stay')}
            </button>
            <button ref={continueBtnRef} type="button" onClick={confirmSwitch}
              className="w-full py-3 rounded-xl font-bold text-sm text-surface-base bg-brand-soft hover:brightness-110 transition-colors">
              {t('reset_pw_switch_btn_continue')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ON-2: приглашённый проходит мастер (приветствие → политика → пароль →
  // синхронизация); голая форма ниже — для сброса пароля.
  if (isInvite && recoveryMode && !linkExpired && !legacyHash) {
    return <InviteWizard email={email} tokenHash={searchParams.get('token_hash')} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">{isInvite ? t('reset_pw_title_invite') : t('reset_pw_title_recovery')}</h1>

        {legacyHash && !done && (
          <div className="space-y-3">
            <p className="text-sm text-accent-warning">
              {t('reset_pw_legacy_hash_warning')}
            </p>
            <button
              type="button"
              onClick={() => { void navigate('/login'); }}
              className="rounded-lg px-3 py-2 bg-accent text-white text-sm"
            >
              {t('reset_pw_btn_go_to_login')}
            </button>
          </div>
        )}

        {!legacyHash && linkExpired && !done && (
          <div className="space-y-3">
            <p className="text-sm text-accent-danger">
              {isInvite ? t('reset_pw_invite_used_message') : t('reset_pw_link_expired_message')}
            </p>
            {/* V-1.2: настройку можно довести до конца только там, где её начали —
                ссылка обменена, и в другом браузере человек увидит это сообщение. */}
            {isInvite && <p className="text-sm text-text-main/70">{t('reset_pw_invite_used_other_browser')}</p>}
            <button
              type="button"
              onClick={() => { void navigate('/login'); }}
              className="rounded-lg px-3 py-2 bg-accent text-white text-sm"
            >
              {isInvite ? t('reset_pw_btn_go_to_login') : t('reset_pw_btn_request_new_link')}
            </button>
          </div>
        )}

        {!recoveryMode && !done && !linkExpired && !legacyHash && (
          <p className="text-sm opacity-70">
            {t('reset_pw_direct_visit_hint')}
          </p>
        )}

        {recoveryMode && !done && !legacyHash && (
          <form onSubmit={e => { void submit(e); }} className="space-y-3">
            <div className="p-3 rounded-lg bg-accent-warning/10 border border-accent-warning/30 text-accent-warning text-xs leading-relaxed">
              {/* D-23/D-28: код восстановления показывается один раз — в настройках его нет. */}
              <strong>{t('reset_pw_encryption_important')}</strong>{t('reset_pw_encryption_warning_text')}
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('reset_pw_input_placeholder')}
              aria-label={t('reset_pw_input_placeholder')}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              className="w-full rounded-lg border px-3 py-2 bg-transparent"
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t('reset_pw_confirm_placeholder')}
              aria-label={t('reset_pw_confirm_placeholder')}
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
              {busy ? t('reset_pw_saving') : t('reset_pw_submit')}
            </button>
          </form>
        )}

        {done && (
          <div className="space-y-3">
            <p className="text-sm">{t('reset_pw_done_message')}</p>
            <button
              type="button"
              onClick={() => { void navigate('/login', email ? { state: { email } } : undefined); }}
              className="rounded-lg px-3 py-2 bg-accent text-white"
            >
              {t('reset_pw_btn_go_to_login')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
