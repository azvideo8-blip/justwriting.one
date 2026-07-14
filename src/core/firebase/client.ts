import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check';

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

// ─── Firebase App Check ──────────────────────────────────────────────────────
// App Check proves every request comes from your legitimate web app, not a
// script. httpsCallable and firebase/auth attach the token automatically; the
// Vercel endpoint /api/chat is NOT a callable, so aiChatTransport reads
// `appCheck` below and sends the token in an x-firebase-appcheck header itself.
//
// LOCAL DEV: set VITE_APPCHECK_DEBUG_TOKEN=true in .env.local, open the app,
// copy the debug token printed in the console into
// Firebase Console → App Check → Apps → your web app → Debug tokens.
//
// PRODUCTION: VITE_RECAPTCHA_SITE_KEY is the reCAPTCHA v3 site key registered
// in Firebase Console → App Check → Apps.
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;

if (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
}

export const appCheck: AppCheck | null = recaptchaSiteKey
  ? initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
  : null;
