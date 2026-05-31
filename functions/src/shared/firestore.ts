import { getFirestore } from 'firebase-admin/firestore';

export const FIRESTORE_DATABASE_ID = 'ai-studio-26638cb9-0855-4980-84cb-072afd2a063d';

export function getDb() {
  return getFirestore(FIRESTORE_DATABASE_ID);
}
