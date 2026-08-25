import { IDataProvider } from '../types';
import * as documents from './documents';
import * as versions from './versions';
import * as profiles from './profiles';
import * as drafts from './drafts';
import * as summaries from './summaries';
import * as embeddings from './embeddings';
import * as localStore from './localStore';

export { likePrefix } from './fields';

export const SupabaseDataProvider: IDataProvider = {
  ...documents,
  ...versions,
  ...profiles,
  ...drafts,
  ...summaries,
  ...embeddings,
  ...localStore,
};
