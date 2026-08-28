import { DataProvider } from '../data';
import { handleDbError, OperationType } from '../errors/db-errors';
import { ProfileService } from './ProfileService';
import { UserProfile } from '../../types';
import { reportError } from '../../shared/errors/reportError';

export const AdminUserService = {
  async getUsers(limitCount: number = 50) {
    try {
      const docs = await DataProvider.getUsers(limitCount);
      return docs.map(d => ({ uid: d.id, ...d })) as UserProfile[];
    } catch (err) {
      reportError(err, { action: 'getUsers' });
      handleDbError(err, OperationType.LIST, 'users');
      return [];
    }
  },
  getProfile: (uid: string) => ProfileService.getProfile(uid).then(r => r.data),
};
