import { getSupabase } from '../supabase/client';
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

// Subscribed on first use, never at import time. A top-level call here builds
// the Supabase client as a side effect of importing this file, which throws
// wherever the env is unset and takes every importer down with it.
function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  getSupabase().auth.onAuthStateChange((_event, session) => {
    currentUser = mapUser(session?.user ?? null);
  });
}

export function getCurrentUser(): AppUser | null {
  ensureSubscribed();
  return currentUser;
}

export function onAuthStateChange(cb: (u: AppUser | null) => void): () => void {
  const { data: { subscription } } = getSupabase().auth.onAuthStateChange((_event, session) => {
    cb(mapUser(session?.user ?? null));
  });
  return () => subscription.unsubscribe();
}

export function onTokenChange(cb: (u: AppUser | null) => void): () => void {
  const { data: { subscription } } = getSupabase().auth.onAuthStateChange((_event, session) => {
    cb(mapUser(session?.user ?? null));
  });
  return () => subscription.unsubscribe();
}

export async function getIdToken(forceRefresh?: boolean): Promise<string | null> {
  if (forceRefresh) {
    await getSupabase().auth.refreshSession();
  }
  const { data: { session } } = await getSupabase().auth.getSession();
  return session?.access_token ?? null;
}

export async function signIn(email: string, password: string): Promise<AppUser> {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return mapUser(data.user)!;
}

export async function signUp(email: string, password: string): Promise<AppUser> {
  const { data, error } = await getSupabase().auth.signUp({ email, password });
  if (error) throw error;
  return mapUser(data.user)!;
}

export async function signOutUser(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}

export async function sendPasswordResetEmail(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email);
  if (error) throw error;
}
