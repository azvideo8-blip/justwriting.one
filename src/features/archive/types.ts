import { Session } from '../../types';

export interface ArchiveSession extends Session {
  _linkedCloudId?: string;
  _hasCloudCopy?: boolean;
  _isLegacy?: boolean;
}
