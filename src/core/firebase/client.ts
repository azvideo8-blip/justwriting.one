import { initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// Validate config
if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes('TODO')) {
  console.error("Firebase API Key is missing or invalid. Please check environment variables.");
}

if (!firebaseConfig.authDomain || firebaseConfig.authDomain.includes('TODO')) {
  console.error("Firebase Auth Domain is missing or invalid. Please check environment variables.");
}

if (!firebaseConfig.projectId || firebaseConfig.projectId.includes('TODO')) {
  console.error("Firebase Project ID is missing or invalid. Please check environment variables.");
}

export const app = initializeApp(firebaseConfig);
