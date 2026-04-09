import { initializeApp } from 'firebase/app';
import firebaseConfig from '../../../firebase-applet-config.json';

// Validate config
if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes('TODO')) {
  console.error("Firebase API Key is missing or invalid. Please check firebase-applet-config.json");
}

if (!firebaseConfig.authDomain || firebaseConfig.authDomain.includes('TODO')) {
  console.error("Firebase Auth Domain is missing or invalid. Please check firebase-applet-config.json");
}

if (!firebaseConfig.projectId || firebaseConfig.projectId.includes('TODO')) {
  console.error("Firebase Project ID is missing or invalid. Please check firebase-applet-config.json");
}

export const app = initializeApp(firebaseConfig);
