import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

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
// script. Once initialized here, firebase/functions httpsCallable and
// firebase/auth automatically attach the token — no changes needed in
// AIService or anywhere else.
//
// LOCAL DEV: Set self.FIREBASE_APPCHECK_DEBUG_TOKEN in the browser console to
// get a debug token printed to the console. Then paste it into:
//   Firebase Console → App Check → Apps → your web app → Debug tokens
// After that App Check works normally in localhost without reCAPTCHA.
//
// PRODUCTION: Set VITE_RECAPTCHA_SITE_KEY in Vercel env vars (reCAPTCHA v3
// site key from console.cloud.google.com → reCAPTCHA Enterprise).
//   Step 1: Get key at https://console.cloud.google.com/security/recaptcha
//   Step 2: Add it to Firebase Console → App Check → Apps → Register
//   Step 3: Set VITE_RECAPTCHA_SITE_KEY in .env.local / Vercel
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;
if (recaptchaSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(recaptchaSiteKey),
    // Automatic token refresh — keeps the token fresh in the background.
    isTokenAutoRefreshEnabled: true,
  });
}
