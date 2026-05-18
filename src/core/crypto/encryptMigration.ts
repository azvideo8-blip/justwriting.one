import { getSessionKey } from './encrypt';
import { maybeEncrypt } from './cryptoHelpers';
import { getClient } from '../firebase/firestoreClient';

export interface MigrationProgress {
  total: number;
  processed: number;
  encrypted: number;
  errors: number;
}

export async function encryptAllExistingNotes(
  userId: string,
  onProgress?: (p: MigrationProgress) => void,
): Promise<MigrationProgress> {
  const key = getSessionKey();
  if (!key) throw new Error('Not unlocked');

  const progress: MigrationProgress = { total: 0, processed: 0, encrypted: 0, errors: 0 };
  const report = () => onProgress?.({ ...progress });

  const { db, mod } = await getClient();
  const { collection, getDocs, query, where, doc, updateDoc, setDoc } = mod;

  try {
    const sessionsSnap = await getDocs(query(collection(db, 'sessions'), where('userId', '==', userId)));
    progress.total += sessionsSnap.docs.length;
    report();

    for (const d of sessionsSnap.docs) {
      try {
        const data = d.data();
        if (data._encrypted) {
          progress.processed++;
          report();
          continue;
        }
        const encrypted = await maybeEncrypt(data as Record<string, unknown>, ['content'], ['pinnedThoughts', 'tags']);
        const clean = Object.fromEntries(Object.entries(encrypted).filter(([, v]) => v !== undefined));
        await updateDoc(doc(db, 'sessions', d.id), clean);
        progress.encrypted++;
      } catch (e) {
        progress.errors++;
        console.error(`encryptAll: session ${d.id} failed:`, e);
      }
      progress.processed++;
      report();
    }
  } catch (e) {
    console.error('encryptAll: sessions query failed:', e);
  }

  try {
    const docsSnap = await getDocs(collection(db, 'users', userId, 'documents'));
    const documentIds = docsSnap.docs.map(d => d.id);

    for (const documentId of documentIds) {
      try {
        const versionsSnap = await getDocs(collection(db, 'users', userId, 'documents', documentId, 'versions'));
        progress.total += versionsSnap.docs.length;
        report();

        for (const v of versionsSnap.docs) {
          try {
            const data = v.data();
            if (data._encrypted) {
              progress.processed++;
              report();
              continue;
            }
            const encrypted = await maybeEncrypt(data as Record<string, unknown>, ['content'], []);
            const clean = Object.fromEntries(Object.entries(encrypted).filter(([, v]) => v !== undefined));
            await updateDoc(doc(db, 'users', userId, 'documents', documentId, 'versions', v.id), clean);
            progress.encrypted++;
          } catch (e) {
            progress.errors++;
            console.error(`encryptAll: version ${v.id} failed:`, e);
          }
          progress.processed++;
          report();
        }
      } catch (e) {
        console.error(`encryptAll: document ${documentId} versions failed:`, e);
      }
    }
  } catch (e) {
    console.error('encryptAll: documents query failed:', e);
  }

  try {
    const draftSnap = await getDocs(query(collection(db, 'drafts'), where('userId', '==', userId)));
    progress.total += draftSnap.docs.length;
    report();

    for (const d of draftSnap.docs) {
      try {
        const data = d.data();
        if (data._encrypted) {
          progress.processed++;
          report();
          continue;
        }
        const encrypted = await maybeEncrypt(data as Record<string, unknown>, ['content'], ['pinnedThoughts']);
        const clean = Object.fromEntries(Object.entries(encrypted).filter(([, v]) => v !== undefined));
        await setDoc(doc(db, 'drafts', d.id), clean, { merge: true });
        progress.encrypted++;
      } catch (e) {
        progress.errors++;
        console.error(`encryptAll: draft ${d.id} failed:`, e);
      }
      progress.processed++;
      report();
    }
  } catch (e) {
    console.error('encryptAll: drafts query failed:', e);
  }

  return progress;
}
