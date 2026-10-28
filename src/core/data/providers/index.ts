/**
 * PROVIDER ARCHITECTURE RULE (DEEP-11 / AG-RESTORE-2 / DUP-5):
 * Any bulk read query (.select) against tables that grow per note or per version
 * (documents, versions, summaries, embeddings, localStore) MUST be paginated using
 * pageAll(...) in batches of PAGE_SIZE (1000, PostgREST default row cap).
 * Unpaginated queries silently truncate at 1000 rows, corrupting counts and syncing.
 */

import { IDataProvider } from '../types';
import * as documents from './documents';
import * as versions from './versions';
import * as profiles from './profiles';
import * as drafts from './drafts';
import * as summaries from './summaries';
import * as embeddings from './embeddings';
import * as localStore from './localStore';
import { pullChangesSince } from './pullChanges';

export { likePrefix } from './fields';
export { rowToLocalStoreRecord, parseStampedAt } from './localStore';

export const SupabaseDataProvider: IDataProvider = {
  ...documents,
  ...versions,
  ...profiles,
  ...drafts,
  ...summaries,
  ...embeddings,
  ...localStore,
  pullChangesSince,
};
