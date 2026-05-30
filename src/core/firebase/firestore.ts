import { app } from './client';

type Firestore = import('firebase/firestore').Firestore;

export let isFirestoreConnected = false;
const connectionListeners: ((status: boolean) => void)[] = [];

export function onConnectionChange(callback: (status: boolean) => void) {
  connectionListeners.push(callback);
  callback(isFirestoreConnected);
  return () => {
    const index = connectionListeners.indexOf(callback);
    if (index > -1) connectionListeners.splice(index, 1);
  };
}

function updateConnectionStatus(status: boolean) {
  if (isFirestoreConnected !== status) {
    isFirestoreConnected = status;
    connectionListeners.forEach(cb => cb(status));
  }
}

let _db: Firestore | null = null;
let _initPromise: Promise<Firestore> | null = null;

export function getDb(): Promise<Firestore> {
  if (_db) return Promise.resolve(_db);
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const {
      initializeFirestore,
      persistentLocalCache,
      persistentMultipleTabManager,
    } = await import('firebase/firestore');

    _db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    }, import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID);

    if (import.meta.env.DEV) {
      console.warn("Firestore initialized with Database ID:", import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID);
    }

    testConnection(0);

    return _db;
  })();

  return _initPromise;
}

let _retryTimer: ReturnType<typeof setTimeout> | null = null;

async function testConnection(retryCount = 0) {
  try {
    const { doc, getDocFromServer } = await import('firebase/firestore');
    if (!_db) return;
    await getDocFromServer(doc(_db, '_connection_test_', 'ping'));
    updateConnectionStatus(true);
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
  } catch (error: unknown) {
    if (error instanceof Error) {
      const reachedServerCodes = ['permission-denied', 'not-found', 'unauthenticated', 'resource-exhausted'];
      const errorCode = 'code' in error ? (error as { code: string }).code : '';

      if (reachedServerCodes.includes(errorCode)) {
        updateConnectionStatus(true);
        if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
      } else {
        console.error("Firestore connection truly failed or timed out:", errorCode, error.message);
        updateConnectionStatus(false);
        if (retryCount < 3) {
          _retryTimer = setTimeout(() => testConnection(retryCount + 1), 5000 * (retryCount + 1));
        }
      }
    } else {
      console.error("Firestore connection truly failed or timed out:", error);
      updateConnectionStatus(false);
      if (retryCount < 3) {
        _retryTimer = setTimeout(() => testConnection(retryCount + 1), 5000 * (retryCount + 1));
      }
    }
  }
}
