import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  updatePassword as firebaseUpdatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth';
import { auth } from '../../../core/firebase/auth';

async function signUpWithEmail(email: string, password: string) {
  return createUserWithEmailAndPassword(auth, email, password);
}

async function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

async function signOut() {
  return firebaseSignOut(auth);
}

async function sendPasswordReset(email: string) {
  return sendPasswordResetEmail(auth, email);
}

async function reauthenticate(currentPassword: string) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error('No authenticated user');

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  return reauthenticateWithCredential(user, credential);
}

async function updatePasswordDirect(newPassword: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('No authenticated user');
  return firebaseUpdatePassword(user, newPassword);
}

function getCurrentUserId(): string | null {
  return auth.currentUser?.uid ?? null;
}

function getCurrentUser() {
  return auth.currentUser;
}

export const AuthService = {
  signUpWithEmail,
  signInWithEmail,
  signOut,
  sendPasswordReset,
  reauthenticate,
  updatePasswordDirect,
  getCurrentUserId,
  getCurrentUser,
};
