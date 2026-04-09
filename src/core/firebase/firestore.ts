import { 
  initializeFirestore,
  doc, 
  getDocFromServer, 
  memoryLocalCache
} from 'firebase/firestore';
import firebaseConfig from '../../../firebase-applet-config.json';
import { app } from './client';

// Use initializeFirestore with forced long polling and memory cache.
// This is the most robust configuration for restricted environments.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  localCache: memoryLocalCache()
}, firebaseConfig.firestoreDatabaseId);

console.log("Firestore initialized with Database ID:", firebaseConfig.firestoreDatabaseId);

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
async function testConnection() {
  try {
    console.log("Starting Firestore connection test to:", firebaseConfig.firestoreDatabaseId);
    // Try to get a document. We use getDocFromServer to bypass any local cache.
    const testDoc = await getDocFromServer(doc(db, '_connection_test_', 'ping'));
    console.log("Firestore connection test: SUCCESS (Document exists or reached server)");
    updateConnectionStatus(true);
  } catch (error: any) {
    console.log("Firestore connection test result details:", {
      code: error.code,
      message: error.message,
      name: error.name
    });

    // In many cases, reaching the server but getting an error is still "connected"
    // permission-denied: we reached the server, but rules blocked us.
    // not-found: we reached the server, but doc doesn't exist.
    // unauthenticated: we reached the server, but auth isn't ready yet.
    const reachedServerCodes = ['permission-denied', 'not-found', 'unauthenticated', 'resource-exhausted'];
    
    if (reachedServerCodes.includes(error.code)) {
      console.log("Firestore reached the backend successfully (received code: " + error.code + ")");
      updateConnectionStatus(true);
    } else {
      console.error("Firestore connection truly failed or timed out:", error.code, error.message);
      updateConnectionStatus(false);
      
      // If it failed, let's try one more time after a short delay
      setTimeout(testConnection, 5000);
    }
  }
}

testConnection();
