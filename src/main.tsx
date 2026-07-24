import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import * as Sentry from "@sentry/react";
import { z } from 'zod';
import { reportError } from './shared/errors/reportError';
import App from './App.tsx';
import './core/analytics/analytics';
import { initWebVitals } from './core/analytics/webVitals';
import './index.css';

// Disable zod's JIT path: it probes `new Function("")`, which our CSP
// (script-src without unsafe-eval) blocks and reports as a violation.
// jitless keeps the interpreted parser and avoids the eval entirely.
z.config({ jitless: true });

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn && sentryDsn.startsWith('https://')) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    enabled: import.meta.env.PROD,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    tracesSampleRate: 0.5,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      if (event.request?.data) delete event.request.data;
      if (event.request?.headers) delete event.request.headers;
      if (event.request?.cookies) delete event.request.cookies;
      return event;
    },

    ignoreErrors: [
      'ResizeObserver loop',
      'Network request failed',
    ],
  });
}

const PRELOAD_RELOAD_KEY = 'jw:preload-reload';

// Recover from stale lazy-chunk loads after a deploy rehashed bundles.
// SW nav is network-first, so a reload fetches the fresh index + new chunks.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault(); // suppress the unhandled throw
  if (sessionStorage.getItem(PRELOAD_RELOAD_KEY)) return; // already tried once — avoid reload loop
  sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
  const payload = (e as unknown as { payload?: unknown })?.payload ?? e;
  reportError(payload, { action: 'vite_preload_error_reload' }, 'warning');
  location.reload();
});

window.addEventListener('unhandledrejection', (event) => {
  reportError(event.reason, { source: 'unhandledrejection' });
});

initWebVitals();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Clear the reload guard only after a stable uptime, so a genuinely broken
// deploy that re-fails immediately keeps the guard and does NOT reload-loop.
// After this window, a later stale-chunk event in the same session can heal.
setTimeout(() => {
  try {
    sessionStorage.removeItem(PRELOAD_RELOAD_KEY);
  } catch {
    // Ignore storage errors
  }
}, 10_000);
