import { getAuth, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, EmailAuthProvider, linkWithCredential, updatePassword } from 'firebase/auth';
import { app } from './client';

export const auth = getAuth(app);
export { signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, EmailAuthProvider, linkWithCredential, updatePassword };
