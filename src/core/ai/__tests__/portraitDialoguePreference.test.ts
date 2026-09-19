import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSendPortraitInDialogue,
  setSendPortraitInDialogue,
  usePortraitDialoguePreferenceStore,
} from '../portraitDialoguePreference';

describe('portraitDialoguePreference', () => {
  beforeEach(() => {
    localStorage.clear();
    usePortraitDialoguePreferenceStore.setState({ values: {} });
  });

  it('defaults to true (send) for an account that never touched the switch', () => {
    expect(getSendPortraitInDialogue('u1')).toBe(true);
  });

  it('remembers an explicit off, and reading survives a fresh in-memory read from localStorage', () => {
    setSendPortraitInDialogue('u1', false);
    expect(getSendPortraitInDialogue('u1')).toBe(false);

    // Simulate a fresh module load (new tab / reload): the store's in-memory
    // map is empty, so getSend must fall back to localStorage, not to the
    // true default.
    usePortraitDialoguePreferenceStore.setState({ values: {} });
    expect(getSendPortraitInDialogue('u1')).toBe(false);
  });

  it('is per account, not global', () => {
    setSendPortraitInDialogue('u1', false);
    expect(getSendPortraitInDialogue('u2')).toBe(true);
  });

  it('turning it back on is remembered too', () => {
    setSendPortraitInDialogue('u1', false);
    setSendPortraitInDialogue('u1', true);
    usePortraitDialoguePreferenceStore.setState({ values: {} });
    expect(getSendPortraitInDialogue('u1')).toBe(true);
  });

  it('falls back to the guest key when no uid is given', () => {
    setSendPortraitInDialogue(undefined, false);
    expect(getSendPortraitInDialogue(undefined)).toBe(false);
    expect(getSendPortraitInDialogue('u1')).toBe(true);
  });
});
