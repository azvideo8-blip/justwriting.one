import { DataProvider } from '../../../core/data';
import { handleFirestoreError, OperationType } from '../../../core/errors/firestore-errors';
import { Label, UserProfile } from '../../../types';
import { reportError } from '../../../shared/errors/reportError';
import { userProfileDbSchema } from '../../../core/data/schemas';
import {
  encryptLabels,
  decryptLabels,
  undecryptedPlaceholder,
  migrateUnencryptedLabels,
  repairDoubleEncryptedLabels,
} from '../../../core/crypto/labelEncryption';
import { getCurrentUser } from '../../../core/auth';

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
      // SEC-7: Encrypt label names before persisting to profile in cloud.
      // Refuses write (throws ENCRYPT_REQUIRED) if vault is locked and encryption enabled.
      const encryptedLabels = await encryptLabels(labels, userId);
      await DataProvider.updateProfile(userId, { labels: encryptedLabels });
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

  async getProfile(userId: string): Promise<{ data: UserProfile | null; error: boolean }> {
    try {
      const snapData = await DataProvider.getProfile(userId);
      if (!snapData) return { data: null, error: false };

      const parsed = userProfileDbSchema.safeParse({ uid: userId, ...snapData });
      if (!parsed.success) {
        reportError(parsed.error, { action: 'getProfile_parse', docId: userId });
        return { data: null, error: false };
      }

      let profileData: UserProfile = parsed.data;
      if (profileData.labels && Array.isArray(profileData.labels)) {
        // SEC-7b: Метки приходят из базы зашифрованными. Расшифровка стоит здесь,
        // в точке входа данных, чтобы все текущие и будущие вызывающие получали
        // расшифрованные имена.
        const currentUid = getCurrentUser()?.uid;
        if (currentUid && currentUid === userId) {
          const rawLabels = profileData.labels as unknown as Record<string, unknown>[];
          // Разовые проходы получают именно сырые метки и живут здесь, а не у
          // вызывающих: признак `_encrypted` есть только до расшифровки, и
          // миграция, накормленная расшифрованным списком, считает его
          // незашифрованным — то есть переписывает профиль при каждом чтении.
          void migrateUnencryptedLabels(userId, rawLabels);
          void repairDoubleEncryptedLabels(userId, rawLabels);
          const decrypted = await decryptLabels(rawLabels);
          profileData = { ...profileData, labels: decrypted };
        } else {
          // При чтении чужого профиля (AdminUserService) ключ сессии администратора
          // не может расшифровать метки пользователя. Возвращаем безопасную заглушку,
          // не вызывая decryptLabel и не засоряя журнал ошибками расшифровки.
          profileData = {
            ...profileData,
            labels: profileData.labels.map(l => {
              const raw = l as unknown as Record<string, unknown>;
              return raw._encrypted === true ? undecryptedPlaceholder(raw) : l;
            }),
          };
        }
      }

      return { data: profileData, error: false };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}`);
      return { data: null, error: true };
    }
  },
};
