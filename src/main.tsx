import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { z } from 'zod';
import { reportError } from './shared/errors/reportError';
import { chunkIsGone } from './shared/errors/chunkReload';
import { finishPendingPurges } from './features/auth/services/bootPurge';
import { APP_VERSION } from './version';
import App from './App.tsx';
import './index.css';

void finishPendingPurges();

// Disable zod's JIT path: it probes `new Function("")`, which our CSP
// (script-src without unsafe-eval) blocks and reports as a violation.
// jitless keeps the interpreted parser and avoids the eval entirely.
z.config({ jitless: true });

document.documentElement.dataset.appVersion = APP_VERSION;
(window as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = APP_VERSION;

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
  const message = payload instanceof Error ? payload.message : String(payload);
  void chunkIsGone(message).then(gone => {
    if (!gone) {
      reportError(payload, { action: 'vite_preload_error_network' }, 'warning');
      return;
    }
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
    reportError(payload, { action: 'vite_preload_error_reload' }, 'warning');
    location.reload();
  });
});

window.addEventListener('unhandledrejection', (event) => {
  reportError(event.reason, { source: 'unhandledrejection' });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MotionConfig>
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
