import { describe, it, expect, beforeEach } from 'vitest';
import { getOrCreateGuestId } from '../guestId';

const GUEST_ID_KEY = 'jw_guest_id';

describe('getOrCreateGuestId', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('generates a new guest id when storage is empty', () => {
    const id = getOrCreateGuestId();
    expect(id).toMatch(/^guest_[a-f0-9-]{36}$/);
  });

  it('stores generated id in localStorage and sessionStorage', () => {
    const id = getOrCreateGuestId();
    expect(localStorage.getItem(GUEST_ID_KEY)).toBe(id);
    expect(sessionStorage.getItem(GUEST_ID_KEY)).toBe(id);
  });

  it('returns existing id from localStorage', () => {
    localStorage.setItem(GUEST_ID_KEY, 'guest_existing');
    const id = getOrCreateGuestId();
    expect(id).toBe('guest_existing');
  });

  it('recovers id from sessionStorage and saves to localStorage', () => {
    sessionStorage.setItem(GUEST_ID_KEY, 'guest_from_session');
    const id = getOrCreateGuestId();
    expect(id).toBe('guest_from_session');
    expect(localStorage.getItem(GUEST_ID_KEY)).toBe('guest_from_session');
  });

  it('prefers localStorage over sessionStorage', () => {
    localStorage.setItem(GUEST_ID_KEY, 'guest_local');
    sessionStorage.setItem(GUEST_ID_KEY, 'guest_session');
    const id = getOrCreateGuestId();
    expect(id).toBe('guest_local');
  });

  it('saves returned id to sessionStorage', () => {
    localStorage.setItem(GUEST_ID_KEY, 'guest_local');
    sessionStorage.removeItem(GUEST_ID_KEY);
    getOrCreateGuestId();
    expect(sessionStorage.getItem(GUEST_ID_KEY)).toBe('guest_local');
  });
});
