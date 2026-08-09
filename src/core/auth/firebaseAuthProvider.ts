import {
  getAuth,
  onAuthStateChanged,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  User as FirebaseUser,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
} from 'firebase/auth';
import { app } from '../firebase/client';
import type { AppUser } from './types';

const auth = getAuth(app);

function toISO(dateString: string | null | undefined): string | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

function mapUser(user: FirebaseUser | null): AppUser | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    metadata: {
      creationTime: toISO(user.metadata?.creationTime),
      lastSignInTime: toISO(user.metadata?.lastSignInTime),
    },
  };
}

export function getCurrentUser(): AppUser | null {
  return mapUser(auth.currentUser);
}

export function onAuthStateChange(cb: (u: AppUser | null) => void): () => void {
  return onAuthStateChanged(auth, (user) => cb(mapUser(user)));
}

export function onTokenChange(cb: (u: AppUser | null) => void): () => void {
  return onIdTokenChanged(auth, (user) => cb(mapUser(user)));
}

export async function getIdToken(forceRefresh?: boolean): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

export async function getTokenClaims(forceRefresh?: boolean): Promise<Record<string, unknown> | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const result = await user.getIdTokenResult(forceRefresh);
  return result.claims;
}

export async function signIn(email: string, password: string): Promise<AppUser> {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return mapUser(credential.user)!;
}

export async function signUp(email: string, password: string): Promise<AppUser> {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  return mapUser(credential.user)!;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}


export async function sendPasswordResetEmail(email: string): Promise<void> {
  await firebaseSendPasswordResetEmail(auth, email);
}
