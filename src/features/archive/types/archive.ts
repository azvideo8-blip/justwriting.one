import type { Session, Label } from '../../../shared/types/common';

export type { Session, Label };

export interface ArchiveSession extends Session {
  _linkedCloudId?: string | undefined;
  _hasCloudCopy?: boolean | undefined;
  _isLegacy?: boolean | undefined;
  _hasPendingSync?: boolean | undefined;
}
