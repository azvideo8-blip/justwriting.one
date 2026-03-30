import { SessionService } from '../../writing/services/SessionService';

export const AdminSessionService = {
  getAllSessionsAdmin: (limit: number) => SessionService.getAllSessionsAdmin(limit),
  deleteSession: (id: string) => SessionService.deleteSession(id),
};
