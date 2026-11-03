import { STORAGE_KEYS } from '../../shared/constants/storageKeys';
import { getSupabase } from '../supabase/client';
import { deriveAuthSecret } from './authSecret';
import { getStoredSessionUid } from './storedSession';
import type { AppUser } from './types';
import { User } from '@supabase/supabase-js';

function mapUser(u: User | null): AppUser | null {
  if (!u) return null;
  return {
    uid: u.id,
    email: u.email ?? null,
    displayName: (u.user_metadata?.['displayName'] as string) ?? null,
    photoURL: (u.user_metadata?.['photoURL'] as string) ?? null,
    metadata: {
      creationTime: u.created_at ?? null,
      lastSignInTime: u.last_sign_in_at ?? null,
    },
  };
}

// Mirrors the session so getCurrentUser() can stay synchronous. Callers depend
// on it returning null during restore rather than waiting — that was a stated
// constraint in MIG1 and Supabase restores asynchronously too.
let currentUser: AppUser | null = null;
let subscribed = false;
let isVoluntarySignOut = false;
// S-33: uid сессии из storage на момент подписки. При неудачном refresh на
// старте supabase-js стирает сессию и шлёт SIGNED_OUT, пока currentUser ещё
// null (auth-js 2.117 _recoverAndRefresh → _removeSession) — без снимка обрыв
// сессии на устройстве B (аккаунт удалён на A, токен истёк) не замечался.
// Сетевой сбой refresh сессию не стирает (isAuthRetryableFetchError), так что
// офлайн-старт сюда не попадает. Снимок одноразовый: его гасит первое событие.
let storedUidAtSubscribe: string | null = null;

// CK-1: расхождение часов устройства и сервера.
//
// Замер на живом стенде (auth-js 2.118, `gt-logs/ck-probe.mjs`, 03.11):
//   вход                  → INITIAL_SESSION (без токена), SIGNED_IN (с токеном)
//   перезагрузка с сохранённой сессией → SIGNED_IN (с токеном), INITIAL_SESSION (с токеном)
// Первый SIGNED_IN во вкладке поэтому вход ОТ восстановления НЕ отличает: при
// перезагрузке в нём лежит старый токен, и его `iat` дал бы ложное «расхождение»
// на величину времени жизни токена. Отличающий признак есть, но другой: был ли
// сохранённый uid в хранилище на момент подписки (`storedUidAtSubscribe`).
// Свежими считаются SIGNED_IN при пустом хранилище и TOKEN_REFRESHED.
//
// Время сервера берём из `iat` токена: заголовок `Date` в ответ не годится — он
// не входит в CORS-safelisted, а клиент ходит на VITE_SUPABASE_URL.
export const CLOCK_SKEW_THRESHOLD_SEC = 300;

let clockSkewSec: number | null = null;
// CK-2: предупреждение показывается один раз на вкладку, а не на каждое
// обновление токена — при спешащих часах обновлений бывает десятки подряд.
let clockSkewWarnedThisTab = false;
// Ревью CK: auth-js шлёт SIGNED_IN со СТАРЫМ токеном и при каждом возврате на
// вкладку (`_onVisibilityChanged` → `_recoverAndRefresh`) и из соседней вкладки.
// Свежим SIGNED_IN считается только первое событие с сессией в этой вкладке.
let sessionSeenThisTab = false;
// Ревью CK: замер старше этого не объясняет сегодняшний выход — часы могли
// поправить, а обновления токена с тех пор не было.
const CLOCK_SKEW_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const clockSkewKey = (uid: string): string => `jw_clock_skew_${uid}`;

/** `iat` из access-токена; битый токен — «не знаю», а не 0 и не ошибка. */
function tokenIatSec(accessToken: unknown): number | null {
  const part = String(accessToken ?? '').split('.')[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { iat?: unknown };
    return typeof claims.iat === 'number' && Number.isFinite(claims.iat) ? claims.iat : null;
  } catch {
    return null;
  }
}

/** Запомнить расхождение: в памяти модуля и под ключом аккаунта (переживёт перезагрузку по выходу). */
function rememberClockSkew(uid: string, skewSec: number): void {
  clockSkewSec = skewSec;
  try { localStorage.setItem(clockSkewKey(uid), JSON.stringify({ s: skewSec, at: Date.now() })); } catch { /* приватный режим: вход не ломаем */ }
}

/**
 * Вызывается из подписки на auth-события. `fresh` — false для событий,
 * восстановивших уже сохранённую сессию: их токен старый, замер по нему врал бы.
 */
function noteClockSkew(uid: string | null, accessToken: unknown, fresh: boolean): void {
  if (!uid || !fresh) return;
  const iat = tokenIatSec(accessToken);
  if (iat === null) return;
  rememberClockSkew(uid, Math.round(Date.now() / 1000 - iat));
}

/** Последнее известное расхождение этого аккаунта; null — «не знаю». */
export function getClockSkewSec(uid?: string | null): number | null {
  if (clockSkewSec !== null) return clockSkewSec;
  if (!uid) return null;
  let raw: string | null = null;
  try { raw = localStorage.getItem(clockSkewKey(uid)); } catch { return null; }
  if (raw === null) return null;
  try {
    const rec = JSON.parse(raw) as { s?: unknown; at?: unknown };
    if (typeof rec.s !== 'number' || !Number.isFinite(rec.s) || typeof rec.at !== 'number') return null;
    return Date.now() - rec.at <= CLOCK_SKEW_MAX_AGE_MS ? rec.s : null;
  } catch {
    return null;
  }
}

/** Часы ушли достаточно, чтобы это объясняло отвал сессии. */
export function isClockSkewed(uid?: string | null): boolean {
  const skew = getClockSkewSec(uid);
  return skew !== null && Math.abs(skew) >= CLOCK_SKEW_THRESHOLD_SEC;
}

/**
 * CK-2: можно ли показать предупреждение про часы. Истинно один раз на вкладку и
 * только когда расхождение известно и не меньше порога.
 */
export function takeClockSkewWarning(uid: string | null): boolean {
  if (clockSkewWarnedThisTab) return false;
  if (!isClockSkewed(uid)) return false;
  clockSkewWarnedThisTab = true;
  return true;
}


import { reportError } from '../../shared/errors/reportError';
import { reloadForAccountChange, isAccountReloadPending, setAccountChangeNotice, _resetAccountReloadForTesting } from './accountReload';

// Subscribed on first use, never at import time. A top-level call here builds
// the Supabase client as a side effect of importing this file, which throws
// wherever the env is unset and takes every importer down with it.
function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  storedUidAtSubscribe = getStoredSessionUid();
  sweepStaleVoluntarySignoutMarks();
  getSupabase().auth.onAuthStateChange((event, session) => {
    const nextUid = session?.user?.id ?? null;
    // CK-1: был ли сохранённый uid на момент подписки. Если был — это
    // восстановление сессии, и токен в первых событиях старый (замер на стенде:
    // при перезагрузке прилетают и SIGNED_IN, и INITIAL_SESSION — оба с токеном).
    const restoring = storedUidAtSubscribe !== null;
    if (event === 'SIGNED_OUT') {
      const lostUid = currentUser?.uid ?? storedUidAtSubscribe;
      if (lostUid !== null && !isVoluntarySignOut && !signedOutElsewhereJustNow(lostUid)) {
        // CK-1/CK-3: если часы спешат, токен выглядит просроченным с рождения,
        // auth-js шлёт обновления подряд и первый сбой обновления рвёт сессию
        // (`_removeSession` → SIGNED_OUT). Это не отзыв сессии сервером.
        const skewSec = getClockSkewSec(lostUid);
        reportError(
          new Error('SESSION_TERMINATED: auth session signed out unexpectedly'),
          { action: 'auth_session_signed_out', previousUid: lostUid, ...(skewSec !== null ? { skewSec } : {}) },
          'warning',
        );
        if (skewSec !== null && Math.abs(skewSec) >= CLOCK_SKEW_THRESHOLD_SEC) {
          // CK-3: человеку говорят правду про часы, а не «сессия потеряна, сотри
          // данные». S-28 (предложение стирания) при известном расхождении НЕ
          // показывается: здесь стирать нечего, локальные данные целы и свои.
          setAccountChangeNotice('clock_skew', lostUid);
        } else {
          // S-28: отличить «аккаунт удалён» от «сессию отозвали» по ответу сервера
          // нельзя (verifyJwt проверяет только подпись), поэтому предложение стереть
          // данные показываем при любом нечаянном выходе — и только если локальная
          // база этого uid на устройстве осталась.
          setAccountChangeNotice('lost_session');
          try { localStorage.setItem(STORAGE_KEYS.LOST_SESSION_UID, lostUid); } catch { /* приватный режим */ }
        }
        // Вошедшего во вкладке не было — перезагрузки по смене аккаунта ниже не
        // будет, а предложение стереть данные читает только новая страница.
        if (currentUser === null) void reloadForAccountChange();
      }
      isVoluntarySignOut = false;
    }
    // CK-1: замер расхождения — только по свежему токену.
    if (event === 'TOKEN_REFRESHED') noteClockSkew(nextUid, session?.access_token, true);
    else if (event === 'SIGNED_IN') noteClockSkew(nextUid, session?.access_token, !restoring && !sessionSeenThisTab);
    if (session) sessionSeenThisTab = true;
    storedUidAtSubscribe = null;
    // Аккаунт вкладки сменился (выход, вход другим, ссылка из письма, то же в
    // соседней вкладке) — перезагрузка: память вкладки принадлежит прежнему
    // человеку (accountReload.ts). currentUser до перезагрузки НЕ меняем:
    // фоновая работа прежнего так и пишет в его базу, а не в базу нового.
    if (accountChanges(nextUid)) {
      void reloadForAccountChange();
      return;
    }
    currentUser = mapUser(session?.user ?? null);
  });
}

// Смена аккаунта — только уход от вошедшего человека. Вход из гостя (null →
// кто-то) — не смена: гостевой текст переходит в аккаунт.
function accountChanges(nextUid: string | null): boolean {
  return currentUser !== null && nextUid !== currentUser.uid;
}

export function getCurrentUser(): AppUser | null {
  ensureSubscribed();
  return currentUser;
}

export function onAuthStateChange(cb: (u: AppUser | null) => void): () => void {
  // Зеркало подписывается первым: пока вкладка ждёт перезагрузки, экран не
  // должен успеть переключиться на нового человека.
  ensureSubscribed();
  // AUTH-1: dedupe emissions by uid. Supabase emits multiple events per sign-in
  // (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED). Without this guard, each
  // creates a new AppUser reference, triggering downstream re-subscriptions.
  let lastUid: string | null | undefined = undefined;
  const { data: { subscription } } = getSupabase().auth.onAuthStateChange((_event, session) => {
    const user = mapUser(session?.user ?? null);
    const uid = user?.uid ?? null;
    if (uid === lastUid) return;
    if (isAccountReloadPending() || accountChanges(uid)) return;
    lastUid = uid;
    cb(user);
  });
  return () => subscription.unsubscribe();
}

export async function getIdToken(forceRefresh?: boolean): Promise<string | null> {
  if (forceRefresh) {
    const { error } = await getSupabase().auth.refreshSession();
    if (error) {
      reportError(error, { action: 'getIdToken_refreshSession' }, 'warning');
      return null;
    }
  }
  const { data: { session } } = await getSupabase().auth.getSession();
  return session?.access_token ?? null;
}

// EA-15: на сервер уходит только секрет, выведенный из пароля (authSecret.ts),
// сам пароль браузер не покидает. Аккаунты, созданные до этого, хранят на
// сервере исходный пароль: если секрет не подошёл, пробуем исходный и, если он
// верен, сразу меняем его на секрет — со следующего входа запасной путь не нужен.
function isInvalidCredentials(error: { code?: string | undefined; message?: string | undefined }): boolean {
  return error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message ?? '');
}

async function signInWithSecret(email: string, password: string) {
  const auth = getSupabase().auth;
  const secret = await deriveAuthSecret(password, email);
  const first = await auth.signInWithPassword({ email, password: secret });
  if (!first.error || !isInvalidCredentials(first.error)) return first;
  // ponytail: запасной путь для аккаунтов до EA-15; убрать, когда все мигрируют.
  const legacy = await auth.signInWithPassword({ email, password });
  if (legacy.error) return first;
  const { error: upErr } = await auth.updateUser({ password: secret });
  if (upErr) reportError(upErr, { action: 'authSecret_migrate' }, 'warning');
  return legacy;
}

export async function signIn(email: string, password: string): Promise<AppUser> {
  const { data, error } = await signInWithSecret(email, password);
  if (error) throw error;
  return mapUser(data.user)!;
}

// AUD-20: удаление аккаунта необратимо и требует пароль снова. Живая сессии
// недостаточно — одолженный разблокированный ноутбук не должен уметь стирать
// архив. Проверка идёт на сервер аутентификации, не в локальное состояние.
export async function reauthenticate(email: string, password: string): Promise<void> {
  const { error } = await signInWithSecret(email, password);
  if (!error) return;
  // «Неверный пароль» — только на ответ «неверные данные». Сбой сети или лимит —
  // не «нет», а «нет ответа»: пробрасываем как есть, иначе человеку говорили бы
  // «неверный пароль» при обрыве связи.
  if (isInvalidCredentials(error)) throw new Error('REAUTH_FAILED');
  throw error;
}

export async function signUp(email: string, password: string): Promise<AppUser> {
  const { data, error } = await getSupabase().auth.signUp({ email, password: await deriveAuthSecret(password, email) });
  if (error) throw error;
  return mapUser(data.user)!;
}

// Выход в одной вкладке приходит в соседние событием SIGNED_OUT, и там он
// выглядел «неожиданным» — ложная запись в журнале. Отметка в localStorage
// общая для вкладок: выход, сделанный человеком несколько секунд назад, — не сбой.
// N-60: отметка своя у каждого аккаунта — выход одного не заглушает сигнал
// «сессия оборвалась» у другого.
function signedOutElsewhereJustNow(uid: string): boolean {
  try { return Date.now() - Number(localStorage.getItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT(uid)) ?? 0) < VOLUNTARY_SIGNOUT_TTL_MS; } catch { return false; }
}

// S-33: отметка добровольного выхода живёт TTL. S-17 стирал её сразу после
// выхода — наперегонки с соседней вкладкой, которая читает её, получив
// SIGNED_OUT через storage-событие; проиграв гонку, та записывала обрыв сессии
// и предлагала стереть данные. Старые отметки убирает старт приложения, молодую
// добирает таймер той же страницы — ключ с uid не остаётся навсегда.
const VOLUNTARY_SIGNOUT_TTL_MS = 60_000;

function sweepStaleVoluntarySignoutMarks(): void {
  try {
    const prefix = STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT('');
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      const age = Date.now() - Number(localStorage.getItem(key));
      if (age >= VOLUNTARY_SIGNOUT_TTL_MS || Number.isNaN(age)) localStorage.removeItem(key);
      else setTimeout(() => { try { localStorage.removeItem(key); } catch { /* приватный режим */ } }, VOLUNTARY_SIGNOUT_TTL_MS - age);
    }
  } catch { /* приватный режим */ }
}

export async function signOutUser(options?: { scope?: 'global' | 'local' | 'others' }): Promise<void> {
  isVoluntarySignOut = true;
  const uid = currentUser?.uid;
  try {
    localStorage.removeItem('jw_voluntary_signout_at');
    if (uid) {
      localStorage.setItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT(uid), String(Date.now()));
    }
  } catch { /* private mode */ }
  try {
    const { error } = await getSupabase().auth.signOut(options);
    if (error) throw error;
  } finally {
    isVoluntarySignOut = false;
  }
}

export function _resetAuthStateForTesting(): void {
  currentUser = null;
  _resetAccountReloadForTesting();
  subscribed = false;
  isVoluntarySignOut = false;
  storedUidAtSubscribe = null;
  clockSkewSec = null;
  clockSkewWarnedThisTab = false;
  sessionSeenThisTab = false;
}

export async function sendPasswordResetEmail(email: string): Promise<void> {
  // redirectTo обязан быть в списке Supabase → Auth → URL Configuration,
  // иначе ссылка молча ведёт на корень сайта.
  const redirectTo = `${window.location.origin}/reset-password`;
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

/**
 * True when the current session came from a password-recovery link. The event
 * (`PASSWORD_RECOVERY`) is the reliable signal — it fires after the client has
 * exchanged the link for a session and does not depend on where the parameters
 * live in the URL (implicit flow puts `type=recovery` in the fragment, PKCE
 * returns `?code=` in the query).
 */
export function onPasswordRecovery(cb: () => void): () => void {
  const { data } = getSupabase().auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') cb();
  });
  return () => data.subscription.unsubscribe();
}

// Ссылка из письма несёт token_hash, а не PKCE-код: код работает только в том
// браузере, где его запросили, а письмо на телефоне открывается в другом.
// 'invite' — тот же обмен для приглашённого, который задаёт первый пароль.
/** Возвращает адрес аккаунта из ссылки: при входе поверх чужой сессии
 * getCurrentUser() сразу после обмена ещё может отдать прежний аккаунт. */
// N-58: ссылка одноразовая. Повторный обмен того же token_hash (StrictMode в
// dev, повторное монтирование страницы) получал отказ и рисовал «ссылка
// устарела» для сработавшей ссылки. Один обмен на хэш — его результат отдаётся всем.
const otpExchanges = new Map<string, Promise<string | null>>();

export function verifyOtpForRecovery(token_hash: string, type: 'recovery' | 'invite' = 'recovery'): Promise<string | null> {
  const key = `${type}:${token_hash}`;
  let p = otpExchanges.get(key);
  if (!p) {
    p = (async () => {
      const { data, error } = await getSupabase().auth.verifyOtp({ token_hash, type });
      if (error) throw error;
      return data.user?.email ?? null;
    })();
    otpExchanges.set(key, p);
    // Неудачный обмен не запоминается: сетевой сбой можно повторить.
    p.catch(() => otpExchanges.delete(key));
  }
  return p;
}

export async function updateUserPassword(password: string): Promise<void> {
  const auth = getSupabase().auth;
  const { data: { user } } = await auth.getUser();
  if (!user?.email) throw new Error('No signed-in user to set a password for');
  const { error } = await auth.updateUser({ password: await deriveAuthSecret(password, user.email) });
  if (error) throw error;
}
