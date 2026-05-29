import posthog from 'posthog-js';

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;

function hasConsent(): boolean {
  try {
    return localStorage.getItem('analytics_consent') === 'true';
  } catch {
    return false;
  }
}

if (key && hasConsent()) {
  posthog.init(key, {
    api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: true,
    autocapture: false,
  });
}

export const analytics = {
  identify(uid: string) {
    if (key && hasConsent()) posthog.identify(uid);
  },
  track(event: string, props?: Record<string, unknown>) {
    if (key && hasConsent()) posthog.capture(event, props);
  },
  reset() {
    if (key && hasConsent()) posthog.reset();
  },
  optIn() {
    if (!key) return;
    localStorage.setItem('analytics_consent', 'true');
    posthog.init(key, {
      api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: true,
      autocapture: false,
    });
  },
  optOut() {
    localStorage.removeItem('analytics_consent');
    if (key) posthog.reset();
  },
};

export function trackEvent(name: string, properties?: Record<string, unknown>): void {
  if (typeof posthog !== 'undefined' && posthog) {
    posthog.capture(name, properties);
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
