import { getClient } from '../../../core/firebase/firestoreClient';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { Label } from '../../../types';
import { reportError } from '../../../core/errors/reportError';
import { userProfileDbSchema } from '../../../shared/schemas/firestoreSchemas';

export const ProfileService = {
  async updateNickname(userId: string, nickname: string) {
    try {
      const { db, mod } = await getClient();
      const { doc, setDoc } = mod;
      await setDoc(doc(db, 'users', userId), { nickname }, { merge: true });
    } catch (err) {
      // [A-04] дублирующий reportError убран: handleFirestoreError уже логирует внутри
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async updateLabels(userId: string, labels: Label[]) {
    try {
      const { db, mod } = await getClient();
      const { doc, setDoc } = mod;
      await setDoc(doc(db, 'users', userId), { labels }, { merge: true });
    } catch (err) {
      // [A-04] дублирующий reportError убран: handleFirestoreError уже логирует внутри
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async updateEarnedAchievements(userId: string, ids: string[]): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, setDoc } = mod;
      await setDoc(doc(db, 'users', userId), { earnedAchievements: ids }, { merge: true });
    } catch (err) {
      // [A-04] дублирующий reportError убран: handleFirestoreError уже логирует внутри
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async resetAchievements(userId: string): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, setDoc } = mod;
      await setDoc(doc(db, 'users', userId), { earnedAchievements: [] }, { merge: true });
    } catch (err) {
      // [A-04] дублирующий reportError убран: handleFirestoreError уже логирует внутри
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async loadEarnedAchievements(userId: string): Promise<{ ids: string[]; error: boolean }> {
    try {
      const { db, mod } = await getClient();
      const { doc, getDoc } = mod;
      const snap = await getDoc(doc(db, 'users', userId));
      if (snap.exists()) {
        const parsed = userProfileDbSchema.safeParse({ uid: userId, ...snap.data() });
        if (!parsed.success) {
          reportError(parsed.error, { action: 'loadEarnedAchievements_parse', docId: userId });
          return { ids: [], error: false };
        }
        return { ids: parsed.data.earnedAchievements, error: false };
      }
      return { ids: [], error: false };
    } catch (err) {
      // [A-04] дублирующий reportError убран: handleFirestoreError уже логирует внутри
      handleFirestoreError(err, OperationType.GET, `users/${userId}`);
      return { ids: [], error: true };
    }
  },

  async getProfile(userId: string): Promise<{ data: Record<string, unknown> | null; error: boolean }> {
    try {
      const { db, mod } = await getClient();
      const { doc, getDoc } = mod;
      const docRef = doc(db, 'users', userId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return { data: docSnap.data(), error: false };
      }
      return { data: null, error: false };
    } catch (err) {
      // [A-04] дублирующий reportError убран: handleFirestoreError уже логирует внутри
      handleFirestoreError(err, OperationType.GET, `users/${userId}`);
      return { data: null, error: true };
    }
  },
};
