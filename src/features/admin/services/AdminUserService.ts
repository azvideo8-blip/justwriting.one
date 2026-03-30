import { query, collection, limit, getDocs } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { ProfileService } from '../../profile/services/ProfileService';

export const AdminUserService = {
  async getUsers(limitCount: number = 50) {
    try {
      const q = query(collection(db, 'users'), limit(limitCount));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'users');
      return [];
    }
  },
  getProfile: (uid: string) => ProfileService.getProfile(uid),
  // Add admin-specific user methods here
};
