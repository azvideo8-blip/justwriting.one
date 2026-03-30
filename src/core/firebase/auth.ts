import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { app } from './client';

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export { signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword };
