import { create } from 'zustand';
import { APP_VERSION } from '../../version';

// Device-level, not account-scoped: a release is the same for everyone on
// this browser, same as app_language — not wiped by "стереть всё с этого
// компьютера".
const LAST_SEEN_KEY = 'last_seen_changelog_version';

function readLastSeen(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

interface ChangelogSeenState {
  hasUnseen: boolean;
  markSeen: () => void;
}

export const useChangelogSeenStore = create<ChangelogSeenState>((set) => ({
  hasUnseen: readLastSeen() !== APP_VERSION,
  markSeen: () => {
    try {
      localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
    } catch { /* non-critical: dot just won't stay dismissed across reloads */ }
    set({ hasUnseen: false });
  },
}));
