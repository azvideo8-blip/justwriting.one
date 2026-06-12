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
      return event;
    },
    ignoreErrors: [
      'ResizeObserver loop',
      'Network request failed',
    ],
  });
}

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
