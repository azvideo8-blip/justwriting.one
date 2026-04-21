import { 
  initializeFirestore,
  doc, 
  getDocFromServer, 
  memoryLocalCache
} from 'firebase/firestore';
import { app } from './client';

// Use initializeFirestore with forced long polling and memory cache.
// This is the most robust configuration for restricted environments.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  localCache: memoryLocalCache()
}, import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID);

if (import.meta.env.DEV) {
  console.warn("Firestore initialized with Database ID:", import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID);
}

// Connection status tracking
export let isFirestoreConnected = true;
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

// Simple connection test
async function testConnection(retryCount = 0) {
  try {
    console.warn("Starting Firestore connection test to:", import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID);
    // Try to get a document. We use getDocFromServer to bypass any local cache.
    await getDocFromServer(doc(db, '_connection_test_', 'ping'));
    console.warn("Firestore connection test: SUCCESS (Document exists or reached server)");
    updateConnectionStatus(true);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.warn("Firestore connection test result details:", {
        code: 'code' in error ? (error as { code: string }).code : undefined,
        message: error.message,
        name: error.name
      });

      // In many cases, reaching the server but getting an error is still "connected"
      // permission-denied: we reached the server, but rules blocked us.
      // not-found: we reached the server, but doc doesn't exist.
      // unauthenticated: we reached the server, but auth isn't ready yet.
      const reachedServerCodes = ['permission-denied', 'not-found', 'unauthenticated', 'resource-exhausted'];
      const errorCode = 'code' in error ? (error as { code: string }).code : '';
      
      if (reachedServerCodes.includes(errorCode)) {
        console.warn("Firestore reached the backend successfully (received code: " + errorCode + ")");
        updateConnectionStatus(true);
      } else {
        console.error("Firestore connection truly failed or timed out:", errorCode, error.message);
        updateConnectionStatus(false);
        
        if (retryCount < 3) {
          setTimeout(() => testConnection(retryCount + 1), 5000 * (retryCount + 1));
        }
      }
    } else {
      console.error("Firestore connection truly failed or timed out:", error);
      updateConnectionStatus(false);
      if (retryCount < 3) {
        setTimeout(() => testConnection(retryCount + 1), 5000 * (retryCount + 1));
      }
    }
  }
}

testConnection(0);
