import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer, terminate, disableNetwork, enableNetwork } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Validate config
if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes('TODO')) {
  console.warn("Firebase API Key is missing or invalid. Please check firebase-applet-config.json");
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

console.log("Initializing Firestore with Database ID:", firebaseConfig.firestoreDatabaseId);

// Use initializeFirestore with aggressive settings for restricted environments
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  host: 'firestore.googleapis.com',
  ssl: true,
}, firebaseConfig.firestoreDatabaseId);

export const googleProvider = new GoogleAuthProvider();
export { signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword };

// Connection status tracking
export let isFirestoreConnected = true;
const connectionListeners: ((status: boolean) => void)[] = [];

export function onConnectionChange(callback: (status: boolean) => void) {
  connectionListeners.push(callback);
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

// Connection test
async function testConnection() {
  try {
    // Try to fetch a non-existent doc just to check connectivity
    // Using getDocFromServer ensures we are actually talking to the backend
    await getDocFromServer(doc(db, '_connection_test_', 'ping'));
    console.log("Firestore connection test: Success (reached backend)");
    updateConnectionStatus(true);
  } catch (error: any) {
    // 'unavailable' or 'the client is offline' errors are what we're looking for
    if (error.message?.includes('the client is offline') || error.code === 'unavailable') {
      console.error("Firestore connection test: FAILED. The backend is unreachable.");
      console.error("Error details:", error);
      updateConnectionStatus(false);
      
      // Try to "kick" the network connection
      try {
        console.log("Attempting to reset Firestore network connection...");
        await disableNetwork(db);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await enableNetwork(db);
      } catch (kickError) {
        console.error("Failed to reset network connection:", kickError);
      }
    } else {
      // Other errors (like 'permission-denied') actually mean we REACHED the backend
      console.log("Firestore connection test: Success (reached backend, but got expected error: " + error.code + ")");
      updateConnectionStatus(true);
    }
  }
}

// Initial test
// testConnection();

// Re-test periodically or on focus
window.addEventListener('focus', testConnection);
// Also re-test every 30 seconds if disconnected
setInterval(() => {
  if (!isFirestoreConnected) testConnection();
}, 30000);
