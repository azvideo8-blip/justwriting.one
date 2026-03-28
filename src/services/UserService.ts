import { doc, updateDoc, getDoc, query, collection, limit, getDocs } from 'firebase/firestore';
import { db } from '../core/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

export const UserService = {
  async updateNickname(userId: string, nickname: string) {
    try {
      await updateDoc(doc(db, 'users', userId), { nickname });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
    }
  },

  async updateLabels(userId: string, labels: any[]) {
    try {
      await updateDoc(doc(db, 'users', userId), { labels });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
    }
  },

  async getProfile(userId: string) {
    try {
      const docRef = doc(db, 'users', userId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data();
      }
      return null;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}`);
      return null;
    }
  },

  async getUsers(limitCount: number = 50) {
    try {
      const q = query(collection(db, 'users'), limit(limitCount));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'users');
      return [];
    }
  },
};
