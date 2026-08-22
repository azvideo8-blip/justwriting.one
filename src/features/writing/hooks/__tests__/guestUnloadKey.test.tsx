// TEST-1 §2.7: the guest unload fallback writes to the key that is actually
// read on return (STORAGE_KEYS.GUEST_DRAFT), not to a dead draft-guest_<uuid>.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { RefObject } from 'react';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';

import { useSyncUnloadSave } from '../useDraftCore';

const guestUser = { uid: 'guest_test-uuid' } as never;

function setRefs() {
  const draftDataRef = {
    current: { pinnedThoughts: [] as string[], sessionStartTime: undefined, activeSessionId: null },
  } as unknown as Parameters<typeof useSyncUnloadSave>[1];
  return { user: guestUser, draftDataRef };
}

beforeEach(() => {
  localStorage.clear();
  useContentStore.setState({ content: 'гостевой текст перед закрытием', wordCount: 5, title: 'Гость', tags: [] });
  useTimerStore.setState({ status: 'writing', seconds: 42 });
});

describe('2.7 guest unload fallback key', () => {
  it('writes to STORAGE_KEYS.GUEST_DRAFT with the typed content', () => {
    const props = setRefs();
    renderHook(() => useSyncUnloadSave(props.user as never, props.draftDataRef));

    window.dispatchEvent(new Event('pagehide'));

    const raw = localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT);
    expect(raw).not.toBeNull();
    expect(raw).toContain('гостевой текст перед закрытием');
    // The dead legacy key must NOT be written for a guest.
    expect(localStorage.getItem(`draft-${(guestUser as { uid: string }).uid}`)).toBeNull();
  });
});
