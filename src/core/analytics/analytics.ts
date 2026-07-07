import type posthog from 'posthog-js';

const key = import.meta.env.VITE_POSTHOG_KEY;

export function hasConsent(): boolean {
  try {
    return localStorage.getItem('analytics_consent') === 'true';
  } catch {
    return false;
  }
}

let posthogPromise: Promise<typeof posthog> | null = null;

export function getPosthog(): Promise<typeof posthog> {
  if (posthogPromise) return posthogPromise;
  posthogPromise = import('posthog-js').then(m => {
    const ph = m.default;
    if (key && hasConsent()) {
      ph.init(key, {
        api_host: import.meta.env.VITE_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: true,
        autocapture: false,
      });
    }
    return ph;
  });
  return posthogPromise;
}

// Proactively run load posthog if consent already exists
if (key && hasConsent()) {
  void getPosthog();
}

export const analytics = {
  identify(uid: string) {
    if (key && hasConsent()) {
      getPosthog().then(ph => ph.identify(uid)).catch(console.error);
    }
  },
  track(event: string, props?: Record<string, unknown>) {
    if (key && hasConsent()) {
      getPosthog().then(ph => ph.capture(event, props)).catch(console.error);
    }
  },
  reset() {
    if (key && hasConsent()) {
      getPosthog().then(ph => ph.reset()).catch(console.error);
    }
  },
  optIn() {
    if (!key) return;
    localStorage.setItem('analytics_consent', 'true');
    getPosthog().then(ph => {
      ph.init(key, {
        api_host: import.meta.env.VITE_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: true,
        autocapture: false,
      });
    }).catch(console.error);
  },
  optOut() {
    localStorage.removeItem('analytics_consent');
    if (key) {
      getPosthog().then(ph => ph.reset()).catch(console.error);
    }
  },
};

export function trackEvent(name: string, properties?: Record<string, unknown>): void {
  if (key && hasConsent()) {
    getPosthog().then(ph => ph.capture(name, properties)).catch(console.error);
  }
}

export const AnalyticsEvents = {
  SESSION_STARTED: 'session_started',
  SESSION_SAVED: 'session_saved',
  DOCUMENT_CREATED: 'document_created',
  DOCUMENT_EXPORTED: 'document_exported',
  ENCRYPTION_ENABLED: 'encryption_enabled',
  ENCRYPTION_UNLOCKED: 'encryption_unlocked',
  AI_CHAT_SENT: 'ai_chat_sent',
  AI_EDIT_USED: 'ai_edit_used',
  SYNC_COMPLETED: 'sync_completed',
} as const;
