import { initializeApp } from 'firebase/app';
import firebaseConfig from '../../../firebase-applet-config.json';

// Validate config
if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes('TODO')) {
  console.warn("Firebase API Key is missing or invalid. Please check firebase-applet-config.json");
}

export const app = initializeApp(firebaseConfig);
