import { getDb } from '../../../core/firebase/firestore';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { ProfileService } from '../../profile/services/ProfileService';
import { UserProfile } from '../../../types';

export const AdminUserService = {
  async getUsers(limitCount: number = 50) {
    try {
      const [{ query, collection, limit, getDocs }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      const q = query(collection(db, 'users'), limit(limitCount));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ uid: d.id, ...d.data() })) as UserProfile[];
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'users');
      return [];
    }
  },
  getProfile: (uid: string) => ProfileService.getProfile(uid),
};
