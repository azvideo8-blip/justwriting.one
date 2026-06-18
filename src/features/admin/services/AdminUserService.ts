import { getClient } from '../../../core/firebase/firestoreClient';
import { handleFirestoreError, OperationType } from '../../../core/errors/firestore-errors';
import { ProfileService } from '../../../core/services/ProfileServiceRef';
import { UserProfile } from '../../../types';
import { reportError } from '../../../shared/errors/reportError';

export const AdminUserService = {
  async getUsers(limitCount: number = 50) {
    try {
      const { db, mod } = await getClient();
      const { query, collection, limit, getDocs } = mod;
      const q = query(collection(db, 'users'), limit(limitCount));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ uid: d.id, ...d.data() })) as UserProfile[];
    } catch (err) {
      reportError(err, { action: 'getUsers' });
      handleFirestoreError(err, OperationType.LIST, 'users');
      return [];
    }
  },
  getProfile: (uid: string) => ProfileService.getProfile(uid).then(r => r.data),
};
