import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';

import { Label } from '../../../types';

export const ProfileService = {
  async updateNickname(userId: string, nickname: string) {
    try {
      await setDoc(doc(db, 'users', userId), { nickname }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
    }
  },

  async updateLabels(userId: string, labels: Label[]) {
    try {
      await updateDoc(doc(db, 'users', userId), { labels });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
    }
  },

  async updateEarnedAchievements(userId: string, ids: string[]): Promise<void> {
    try {
      await updateDoc(doc(db, 'users', userId), { earnedAchievements: ids });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
    }
  },

  async resetAchievements(userId: string): Promise<void> {
    try {
      await updateDoc(doc(db, 'users', userId), { earnedAchievements: [] });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
    }
  },

  async loadEarnedAchievements(userId: string): Promise<string[]> {
    try {
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
