import { STORAGE_KEYS } from '../../shared/constants/storageKeys';
import { getSupabase } from '../supabase/client';
import { deriveAuthSecret } from './authSecret';
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

import { reportError } from '../../shared/errors/reportError';
import { reloadForAccountChange, isAccountReloadPending, _resetAccountReloadForTesting } from './accountReload';

// Subscribed on first use, never at import time. A top-level call here builds
// the Supabase client as a side effect of importing this file, which throws
// wherever the env is unset and takes every importer down with it.
function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  getSupabase().auth.onAuthStateChange((event, session) => {
    const nextUid = session?.user?.id ?? null;
    if (event === 'SIGNED_OUT') {
      if (currentUser !== null && !isVoluntarySignOut && !signedOutElsewhereJustNow(currentUser.uid)) {
        reportError(
          new Error('SESSION_TERMINATED: auth session signed out unexpectedly'),
          { action: 'auth_session_signed_out', previousUid: currentUser.uid },
          'warning',
        );
      }
      isVoluntarySignOut = false;
    }
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

export function onTokenChange(cb: (u: AppUser | null) => void): () => void {
  ensureSubscribed();
  // AUTH-1: same last-emitted-uid guard as onAuthStateChange.
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
  if (error) {
    throw new Error('REAUTH_FAILED');
  }
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
  try { return Date.now() - Number(localStorage.getItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT(uid)) ?? 0) < 10_000; } catch { return false; }
}

export async function signOutUser(options?: { scope?: 'global' | 'local' | 'others' }): Promise<void> {
  isVoluntarySignOut = true;
  const uid = currentUser?.uid;
  if (uid) { try { localStorage.setItem(STORAGE_KEYS.VOLUNTARY_SIGNOUT_AT(uid), String(Date.now())); } catch { /* private mode */ } }
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
