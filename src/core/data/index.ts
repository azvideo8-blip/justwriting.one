export * from './types';
import { FirestoreDataProvider } from './firestoreDataProvider';
import { IDataProvider } from './types';

// Export a singleton instance
export const DataProvider: IDataProvider = FirestoreDataProvider;
