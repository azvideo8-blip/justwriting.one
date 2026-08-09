import { DataProvider } from '../../../core/data';
import { handleFirestoreError, OperationType } from '../../../core/errors/firestore-errors';
import { Label } from '../../../types';
import { reportError } from '../../../shared/errors/reportError';
import { userProfileDbSchema } from '../../../core/data/schemas';

export const ProfileService = {
  async updateNickname(userId: string, nickname: string) {
    try {
      await DataProvider.updateProfile(userId, { nickname });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async acceptPrivacyPolicy(userId: string) {
    try {
      await DataProvider.updateProfile(userId, {
        privacyAcceptedAt: new Date(),
        privacyVersion: 1,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async updateLabels(userId: string, labels: Label[]) {
    try {
      await DataProvider.updateProfile(userId, { labels });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async updateEarnedAchievements(userId: string, ids: string[]): Promise<void> {
    try {
      await DataProvider.updateProfile(userId, { earnedAchievements: ids });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async resetAchievements(userId: string): Promise<void> {
    try {
      await DataProvider.updateProfile(userId, { earnedAchievements: [] });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async loadEarnedAchievements(userId: string): Promise<{ ids: string[]; error: boolean }> {
    try {
      const snapData = await DataProvider.getProfile(userId);
      if (snapData) {
        const parsed = userProfileDbSchema.safeParse({ uid: userId, ...snapData });
        if (!parsed.success) {
          reportError(parsed.error, { action: 'loadEarnedAchievements_parse', docId: userId });
          return { ids: [], error: false };
        }
        return { ids: parsed.data.earnedAchievements, error: false };
      }
      return { ids: [], error: false };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}`);
      return { ids: [], error: true };
    }
  },

  async getProfile(userId: string): Promise<{ data: Record<string, unknown> | null; error: boolean }> {
    try {
      const snapData = await DataProvider.getProfile(userId);
      if (snapData) {
        return { data: snapData, error: false };
      }
      return { data: null, error: false };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}`);
      return { data: null, error: true };
    }
  },
};
