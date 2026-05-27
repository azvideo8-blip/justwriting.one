import { initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const missingKeys: string[] = [];
for (const [key, value] of Object.entries(firebaseConfig)) {
  if (!value || (typeof value === 'string' && value.includes('TODO'))) {
    missingKeys.push(key);
  }
}
if (missingKeys.length > 0) {
  throw new Error(
    `Invalid Firebase configuration. Missing/TODO keys: ${missingKeys.join(', ')}. ` +
    'Check your .env file (VITE_FIREBASE_* variables).'
  );
}

export const app = initializeApp(firebaseConfig);
