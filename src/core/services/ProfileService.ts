import { DataProvider } from '../data';
import { handleDbError, OperationType } from '../errors/db-errors';
import { Label, UserProfile } from '../../types';
import { reportError } from '../../shared/errors/reportError';
import { userProfileDbSchema } from '../data/schemas';
import {
  encryptLabel,
  decryptLabel,
  decryptLabels,
  undecryptedPlaceholder,
  migrateUnencryptedLabels,
  repairDoubleEncryptedLabels,
} from '../crypto/labelEncryption';
import { getCurrentUser } from '../auth';

export type LabelEdit =
  | { add: Label }
  /** Без `name` имя в облаке не трогается (смена цвета работает и при запертом сейфе). */
  | { update: { id: string; name?: string | undefined; color?: string | undefined } }
  | { remove: string };

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

  /**
   * LB-1: правка одной метки. Список берётся из облака, а не с экрана: правится
   * сырой список (нетронутые метки уходят обратно как есть, без расшифровки),
   * запись — только под версией строки, с которой список прочитан. Чужая запись
   * между чтением и записью — перечитать и повторить. Бросает при любом отказе;
   * вернулось значение — правка в облаке, это новый список (расшифрованный).
   */
  async editLabels(userId: string, edit: LabelEdit): Promise<Label[]> {
    try {
      // SEC-7: имя шифруется до записи; сейф заперт — ENCRYPT_REQUIRED, отказ.
      const fresh: Record<string, unknown> | null = 'add' in edit ? { ...await encryptLabel(edit.add, userId) }
        : 'update' in edit && edit.update.name !== undefined
          ? { ...await encryptLabel({ id: edit.update.id, name: edit.update.name, color: '' }, userId) }
          : null;
      const read = async () => {
        const row = await DataProvider.getProfileLabels(userId);
        // «Не прочитано» — не «пусто»: строки нет или поле не список — отказ.
        // SQL null — строка есть, меток нет.
        if (!row || (row.labels != null && !Array.isArray(row.labels))) throw new Error('LABELS_UNREADABLE');
        return { raw: (row.labels ?? []) as Array<Record<string, unknown>>, version: row.version };
      };
      const apply = (raw: Array<Record<string, unknown>>) => {
        // Метка с этим id уже в списке — добавление состоялось раньше (повтор после
        // потерянного ответа, двойное нажатие): второй не дописываем.
        if ('add' in edit) return raw.some(l => l.id === edit.add.id) ? raw : [...raw, fresh!];
        if ('remove' in edit) return raw.some(l => l.id === edit.remove) ? raw.filter(l => l.id !== edit.remove) : raw;
        const { id, color } = edit.update;
        // Метку удалили на другом устройстве: «сохранено» было бы неправдой.
        const current = raw.find(l => l.id === id);
        if (!current) throw new Error('LABEL_GONE');
        if (!fresh && (color === undefined || color === current.color)) return raw;
        return raw.map(l => l !== current ? l : { ...(fresh ?? l), color: color ?? l.color });
      };
      // Повтор уже состоявшегося переименования: шифротекст каждый раз новый,
      // поэтому «то же ли имя» видно только после расшифровки.
      const renamed = async (raw: Array<Record<string, unknown>>) => {
        if (!('update' in edit) || edit.update.name === undefined) return false;
        const current = raw.find(l => l.id === edit.update.id);
        if (!current || (edit.update.color !== undefined && edit.update.color !== current.color)) return false;
        const shown = await decryptLabel(current);
        return !shown._undecrypted && shown.name === edit.update.name;
      };
      // ponytail: 5 попыток; каждая проигранная — чья-то состоявшаяся запись.
      // Мало — поднять число, очередь не нужна.
      for (let attempt = 0; attempt < 5; attempt++) {
        const { raw, version } = await read();
        const next = apply(raw);
        if (next === raw) return await decryptLabels(raw);
        try {
          if (await DataProvider.replaceProfileLabels(userId, version, next)) return await decryptLabels(next);
        } catch (writeError) {
          // Запись могла пройти, а ответ потеряться. Перечитываем: правка уже в
          // облаке — это успех, иначе отказ с исходной ошибкой.
          const after = await read().catch(() => null);
          if (after && (apply(after.raw) === after.raw || await renamed(after.raw))) return await decryptLabels(after.raw);
          throw writeError;
        }
      }
      throw new Error('LABELS_CONFLICT');
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
