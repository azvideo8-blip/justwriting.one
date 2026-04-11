import { SessionService } from '../../writing/services/SessionService';

export const AdminSessionService = {
  getAllSessionsAdmin: (limit: number, lastDoc?: unknown) => SessionService.getAllSessionsAdmin(limit, lastDoc),
  deleteSession: (id: string) => SessionService.deleteSession(id),
};
