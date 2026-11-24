import { DataProvider } from '../data';
import { handleDbError, OperationType } from '../errors/db-errors';
import { Label, UserProfile } from '../../types';
import { reportError } from '../../shared/errors/reportError';
import { userProfileDbSchema } from '../data/schemas';
import {
  encryptLabels,
  decryptLabels,
  undecryptedPlaceholder,
  migrateUnencryptedLabels,
  repairDoubleEncryptedLabels,
} from '../crypto/labelEncryption';
import { getCurrentUser } from '../auth';

export const ProfileService = {
  async updateNickname(userId: string, nickname: string) {
    const trimmed = nickname.trim();
    if (!trimmed) return;
    try {
      await DataProvider.updateProfile(userId, { nickname: trimmed });
    } catch (err) {
      handleDbError(err, OperationType.UPDATE, `users/${userId}`);
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
      handleDbError(err, OperationType.UPDATE, `users/${userId}`);
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
      handleDbError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async updateEarnedAchievements(userId: string, ids: string[]): Promise<void> {
    try {
      await DataProvider.updateProfile(userId, { earnedAchievements: ids });
    } catch (err) {
      handleDbError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async resetAchievements(userId: string): Promise<void> {
    try {
      // Tombstone-момент сброса (#100): union-merge с другого устройства не
      // должен переигрывать набор, заработанный до reset. Клиент сравнивает
      // earnedAt ачивок с этой меткой.
      await DataProvider.updateProfile(userId, {
        earnedAchievements: [],
        achievementsResetAt: new Date(),
      });
    } catch (err) {
      handleDbError(err, OperationType.UPDATE, `users/${userId}`);
      throw err;
    }
  },

  async loadEarnedAchievements(userId: string): Promise<{ ids: string[]; error: boolean; resetAt: Date | null }> {
    try {
      const snapData = await DataProvider.getProfile(userId);
      if (snapData) {
        const parsed = userProfileDbSchema.safeParse({ uid: userId, ...snapData });
        if (!parsed.success) {
          reportError(parsed.error, { action: 'loadEarnedAchievements_parse', docId: userId });
          // Н-4: строка есть, но не разобралась — «не прочитали», а не «пусто».
          return { ids: [], error: true, resetAt: null };
        }
        const resetRaw: unknown = parsed.data.achievementsResetAt;
        const resetMs = resetRaw == null ? NaN : new Date(resetRaw as string | number).getTime();
        const resetAt = Number.isNaN(resetMs) ? null : new Date(resetMs);
        return {
          ids: parsed.data.earnedAchievements,
          error: false,
          resetAt,
        };
      }
      return { ids: [], error: false, resetAt: null };
    } catch (err) {
      handleDbError(err, OperationType.GET, `users/${userId}`);
      return { ids: [], error: true, resetAt: null };
    }
  },

  async getProfile(userId: string): Promise<{ data: UserProfile | null; error: boolean }> {
    try {
      const snapData = await DataProvider.getProfile(userId);
      if (!snapData) return { data: null, error: false };

      const parsed = userProfileDbSchema.safeParse({ uid: userId, ...snapData });
      if (!parsed.success) {
        reportError(parsed.error, { action: 'getProfile_parse', docId: userId });
        // Н-4: строка есть, но не разобралась — «не прочитали», а не «профиля нет»:
        // иначе контекст создаёт профиль заново и затирает ник.
        return { data: null, error: true };
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
      handleDbError(err, OperationType.GET, `users/${userId}`);
      return { data: null, error: true };
    }
  },
};
