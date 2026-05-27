import posthog from 'posthog-js';

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;

if (key) {
  posthog.init(key, {
    api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: true,
    autocapture: false,
  });
}

export const analytics = {
  identify(uid: string) {
    if (key) posthog.identify(uid);
  },
  track(event: string, props?: Record<string, unknown>) {
    if (key) posthog.capture(event, props);
  },
  reset() {
    if (key) posthog.reset();
  },
};
