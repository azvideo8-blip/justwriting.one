import { describe, it, expect, beforeEach, vi } from 'vitest';
import { APP_VERSION } from '../../../version';

const LAST_SEEN_KEY = 'last_seen_changelog_version';

async function freshStore() {
  vi.resetModules();
  return await import('../useChangelogSeenStore');
}

describe('useChangelogSeenStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with hasUnseen=true when no version was ever recorded', async () => {
    const { useChangelogSeenStore } = await freshStore();
    expect(useChangelogSeenStore.getState().hasUnseen).toBe(true);
  });

  it('starts with hasUnseen=false when the current version was already seen', async () => {
    localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
    const { useChangelogSeenStore } = await freshStore();
    expect(useChangelogSeenStore.getState().hasUnseen).toBe(false);
  });

  it('starts with hasUnseen=true when a different (older) version was seen', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '0.0.1');
    const { useChangelogSeenStore } = await freshStore();
    expect(useChangelogSeenStore.getState().hasUnseen).toBe(true);
  });

  it('markSeen() records the current version and flips hasUnseen to false', async () => {
    const { useChangelogSeenStore } = await freshStore();
    expect(useChangelogSeenStore.getState().hasUnseen).toBe(true);

    useChangelogSeenStore.getState().markSeen();

    expect(useChangelogSeenStore.getState().hasUnseen).toBe(false);
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe(APP_VERSION);
  });
});
