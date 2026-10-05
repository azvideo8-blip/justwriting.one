export * from './types';
export { rowToLocalStoreRecord, parseStampedAt } from './providers/index';
import { SupabaseDataProvider } from './supabaseDataProvider';
import { IDataProvider } from './types';

// Export a singleton instance
export const DataProvider: IDataProvider = SupabaseDataProvider;
