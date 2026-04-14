import { SessionService } from '../../writing/services/SessionService';
import { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';

export const AdminSessionService = {
  getAllSessionsAdmin: (limit: number, lastDoc?: QueryDocumentSnapshot<DocumentData, DocumentData>) => SessionService.getAllSessionsAdmin(limit, lastDoc),
  deleteSession: (id: string) => SessionService.deleteSession(id),
};
