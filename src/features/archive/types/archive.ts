import type { Session, Label } from '../../../shared/types/common';

export type { Session, Label };

export interface ArchiveSession extends Session {
  _linkedCloudId?: string;
  _hasCloudCopy?: boolean;
  _isLegacy?: boolean;
}
