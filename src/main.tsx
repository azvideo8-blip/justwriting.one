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

      // The context keys are scrubbed by reportError, but the error MESSAGE was
      // not — and messages are built with template literals, so anything a
      // caller interpolates leaves the device verbatim. That is a promise this
      // app makes about the user's notes, so the guarantee cannot rest on every
      // future caller remembering. Anything in quotes is dropped: it is the
      // shape user-derived fragments are interpolated in, and no diagnostic
      // value is lost — the sentence around it still identifies the site.
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = ex.value.replace(/"[^"]*"|«[^»]*»/g, '"[скрыто]"');
      }
      if (event.message) event.message = event.message.replace(/"[^"]*"|«[^»]*»/g, '"[скрыто]"');
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
// Deliberately NOT calling e.preventDefault(): that tells Vite to swallow the
// error, which makes the failed import *resolve* instead of reject. Our lazy
// routes are `import(...).then(m => ({ default: m.Page }))`, so the mapper then
// runs with m === undefined and throws "Cannot read properties of undefined
// (reading 'WritingPage')" — a misleading error that hides the real cause (the
// chunk never loaded) and, once the reload guard has tripped, leaves the app
// broken with no recovery. Letting the real error propagate keeps the signature
// honest and lets the error boundary render.
window.addEventListener('vite:preloadError', (e) => {
  const payload = (e as unknown as { payload?: unknown })?.payload ?? e;
  if (sessionStorage.getItem(PRELOAD_RELOAD_KEY)) {
    // Reloading once did not fix it — usually the network is down rather than
    // the chunk being stale. Report it and let the error surface.
    reportError(payload, { action: 'vite_preload_error_after_reload' }, 'warning');
    return;
  }
  sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
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
