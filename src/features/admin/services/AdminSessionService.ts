import { SessionService } from '../../writing/services/SessionService';

export const AdminSessionService = {
  getAllSessionsAdmin: (limit: number, lastDoc?: any) => SessionService.getAllSessionsAdmin(limit, lastDoc),
  deleteSession: (id: string) => SessionService.deleteSession(id),
};
