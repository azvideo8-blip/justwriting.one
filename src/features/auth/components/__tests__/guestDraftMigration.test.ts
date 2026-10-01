import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkGuestDocuments } from '../MigrationPrompt';
import { getLocalDb } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import * as authModule from '../../../../core/auth';

describe('checkGuestDocuments (S-8)', () => {
  beforeEach(async () => {
    localStorage.clear();
    const guestDb = await getLocalDb('justwriting-local');
    if (guestDb.objectStoreNames.contains('drafts')) {
      await guestDb.clear('drafts');
    }
    if (guestDb.objectStoreNames.contains('documents')) {
      await guestDb.clear('documents');
    }
  });

  it('detects draft in guest DB when getCurrentUser returns signed-in uid', async () => {
    vi.spyOn(authModule, 'getCurrentUser').mockReturnValue({
      uid: 'user_signed_in_s8',
      email: 'user@example.com',
    } as any);

    const guestDb = await getLocalDb('justwriting-local');
    await guestDb.put('drafts', {
      userId: 'guest_draft',
      content: 'Unsaved guest draft content',
      updatedAt: Date.now(),
    } as any);

    const res = await checkGuestDocuments();
    expect(res).not.toBeNull();
    expect(res?.hasDraft).toBe(true);
  });

  it('detects draft in localStorage fallback when getCurrentUser returns signed-in uid', async () => {
    vi.spyOn(authModule, 'getCurrentUser').mockReturnValue({
      uid: 'user_signed_in_s8',
      email: 'user@example.com',
    } as any);

    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({
      content: 'Draft from localStorage',
      updatedAt: Date.now(),
    }));

    const res = await checkGuestDocuments();
    expect(res).not.toBeNull();
    expect(res?.hasDraft).toBe(true);
  });
});
