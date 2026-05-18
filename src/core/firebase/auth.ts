import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, EmailAuthProvider, linkWithCredential, updatePassword } from 'firebase/auth';
import { app } from './client';

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export { signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, EmailAuthProvider, linkWithCredential, updatePassword };
