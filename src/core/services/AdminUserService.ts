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
}

export const AdminUserService = {
  async getUsers(limitCount: number = 50): Promise<AdminUserItem[]> {
    try {
      const docs = await DataProvider.getUsers(limitCount);
      const profiles = docs.map(d => ({ uid: d.id, ...d })) as AdminUserItem[];

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

        return enrichedProfiles;
      } catch (e) {
        reportError(e, { action: 'listUsersWithStatus in AdminUserService.getUsers' });
        return profiles;
      }
    } catch (err) {
      reportError(err, { action: 'getUsers' });
      handleDbError(err, OperationType.LIST, 'users');
      return [];
    }
  },

  async inviteUser(email: string): Promise<{ user: { id?: string | undefined; email?: string | undefined }; reinvited?: boolean }> {
    return callAi<{ user: { id?: string | undefined; email?: string | undefined }; reinvited?: boolean }>('inviteUser', { email });
  },

  async listUsersWithStatus(): Promise<UserStatusItem[]> {
    return callAi<UserStatusItem[]>('listUsersWithStatus', {});
  },

  getProfile: (uid: string) => ProfileService.getProfile(uid).then(r => r.data),
};
