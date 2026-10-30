import { DataProvider } from '../data';
import { handleDbError, OperationType } from '../errors/db-errors';
import { ProfileService } from './ProfileService';
import { AdminUserItem } from '../../types';
import { reportError } from '../../shared/errors/reportError';
import { callAi } from '../ai/callAi';

export interface UserStatusItem {
  uid: string;
  email: string;
  invitedAt: string | null;
  confirmedAt: string | null;
  createdAt: string | null;
  noteCount: number;
  pending: boolean;
  /** 0040: служебный аккаунт — удалить из админки нельзя. */
  service?: boolean;
}

/** C-6: неподтверждённое приглашение старше 30 дней. */
export interface StaleInviteItem {
  uid: string;
  email: string;
  invitedAt: string;
}

/** R7Q-014: строка следа админских действий (public.admin_actions). */
export interface AdminActionItem {
  id: number;
  at: string;
  adminUid: string;
  action: string;
  targetUid: string;
}

export interface AdminUsersResult {
  users: AdminUserItem[];
  /** A-2: статусы приглашений/заметок не прочитались — список есть, пометка обязательна. */
  statusesFailed: boolean;
  /** D-11: сервер отдал больше строк, чем показано (limit+1). */
  truncated: boolean;
}

export const AdminUserService = {
  async getUsers(limitCount: number = 50): Promise<AdminUsersResult> {
    try {
      const docs = await DataProvider.getUsers(limitCount);
      const truncated = docs.length > limitCount;
      const profiles = docs.slice(0, limitCount).map(d => ({ uid: d.id, ...d })) as AdminUserItem[];

      try {
        const statuses = await AdminUserService.listUsersWithStatus();
        const statusMap = new Map<string, UserStatusItem>();
        const seenUids = new Set<string>();

        for (const s of statuses) {
          if (s.uid) statusMap.set(s.uid, s);
          if (s.email) statusMap.set(s.email.toLowerCase(), s);
        }

        const enrichedProfiles = profiles.map(p => {
          seenUids.add(p.uid);
          const s = statusMap.get(p.uid) || (p.email ? statusMap.get(p.email.toLowerCase()) : undefined);
          if (s) {
            return {
              ...p,
              pending: s.pending,
              noteCount: s.noteCount,
              invitedAt: s.invitedAt,
              confirmedAt: s.confirmedAt,
              service: s.service === true,
            };
          }
          return p;
        });

        // Add any pending / invited users from auth.users that don't have rows in public.users yet
        const addedUids = new Set<string>();
        for (const s of statuses) {
          if (!seenUids.has(s.uid) && !addedUids.has(s.uid)) {
            addedUids.add(s.uid);
            enrichedProfiles.push({
              uid: s.uid,
              email: s.email,
              nickname: '',
              role: 'user',
              pending: s.pending,
              noteCount: s.noteCount,
              invitedAt: s.invitedAt,
              confirmedAt: s.confirmedAt,
            });
          }
        }

        return { users: enrichedProfiles.slice(0, limitCount), statusesFailed: false, truncated };
      } catch (e) {
        reportError(e, { action: 'listUsersWithStatus in AdminUserService.getUsers' });
        return { users: profiles, statusesFailed: true, truncated };
      }
    } catch (err) {
      reportError(err, { action: 'getUsers' });
      handleDbError(err, OperationType.LIST, 'users');
      // A-2: пустая таблица при сбое — ложь. Бросаем, экран покажет ошибку и «Повторить».
      throw err;
    }
  },

  async inviteUser(email: string): Promise<{ user: { id?: string | undefined; email?: string | undefined }; reinvited?: boolean }> {
    return callAi<{ user: { id?: string | undefined; email?: string | undefined }; reinvited?: boolean }>('inviteUser', { email });
  },

  async deleteUser(uid: string): Promise<void> {
    await callAi<{ success: true }>('adminDeleteUser', { uid });
  },

  async listUsersWithStatus(): Promise<UserStatusItem[]> {
    return callAi<UserStatusItem[]>('listUsersWithStatus', {});
  },

  /** C-6: список приглашений старше 30 дней — только по кнопке. */
  async listStaleInvites(): Promise<StaleInviteItem[]> {
    return callAi<StaleInviteItem[]>('listStaleInvites', {});
  },

  /** C-6: удалить выбранные просроченные приглашения; сервер перепроверяет условие. */
  async deleteStaleInvites(uids: string[]): Promise<{ deleted: number }> {
    // Сервер принимает до 100 за запрос, список — до 500: шлём пачками.
    let deleted = 0;
    for (let i = 0; i < uids.length; i += 100) {
      deleted += (await callAi<{ deleted: number }>('deleteStaleInvites', { uids: uids.slice(i, i + 100) })).deleted;
    }
    return { deleted };
  },

  /** R7Q-014: последние строки admin_actions. Только чтение, сервер проверяет админа. */
  async listAdminActions(limit = 50): Promise<AdminActionItem[]> {
    return callAi<AdminActionItem[]>('listAdminActions', { limit });
  },

  getProfile: (uid: string) => ProfileService.getProfile(uid).then(r => r.data),
};
