import { getAuth, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, EmailAuthProvider, updatePassword } from 'firebase/auth';
import { app } from './client';

export const auth = getAuth(app);
export { signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, EmailAuthProvider, updatePassword };
