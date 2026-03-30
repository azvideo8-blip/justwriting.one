import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';
import { User } from 'firebase/auth';

export const AuthService = {
  async getUserRole(user: User): Promise<'admin' | 'user' | null> {
    try {
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data().role || 'user';
      }
      return 'user';
    } catch (err) {
      console.error('Error fetching user role:', err);
      return null;
    }
  },

  async isAdmin(user: User): Promise<boolean> {
    const role = await this.getUserRole(user);
    return role === 'admin';
  }
};
