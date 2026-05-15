import { getDb } from '../../../core/firebase/firestore';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { Label } from '../../../types';

export const ProfileService = {
  async updateNickname(userId: string, nickname: string) {
    try {
      const [{ doc, setDoc }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      await setDoc(doc(db, 'users', userId), { nickname }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async updateLabels(userId: string, labels: Label[]) {
    try {
      const [{ doc, setDoc }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      await setDoc(doc(db, 'users', userId), { labels }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async updateEarnedAchievements(userId: string, ids: string[]): Promise<void> {
    try {
      const [{ doc, setDoc }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      await setDoc(doc(db, 'users', userId), { earnedAchievements: ids }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async resetAchievements(userId: string): Promise<void> {
    try {
      const [{ doc, setDoc }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      await setDoc(doc(db, 'users', userId), { earnedAchievements: [] }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async loadEarnedAchievements(userId: string): Promise<string[]> {
    try {
      const [{ doc, getDoc }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      const snap = await getDoc(doc(db, 'users', userId));
      if (snap.exists()) {
        return (snap.data().earnedAchievements as string[]) ?? [];
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}`);
    }
    return [];
  },

  async getProfile(userId: string) {
    try {
      const [{ doc, getDoc }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
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
};
