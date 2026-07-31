import type { Session, Label } from '../../../shared/types/common';

export type { Session, Label };

export interface ArchiveSession extends Session {
  _linkedCloudId?: string | undefined;
  _hasCloudCopy?: boolean | undefined;
  _isLegacy?: boolean | undefined;
  _hasPendingSync?: boolean | undefined;
  _locked?: boolean | undefined;
  _decryptionError?: boolean | undefined;
  _contentError?: boolean | undefined;
  // Cloud-only note whose text the list view did not fetch. Not the same as an
  // empty note — load it before showing or exporting.
  _contentNotLoaded?: boolean | undefined;
}
