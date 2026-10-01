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

  // S-44.4: черновик старше 7 дней слой письма уже не показывает — и окно
  // переноса не должно предлагать перенести его.
  it.each([
    ['localStorage', async (updatedAt: number) => { localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({ content: 'старый', updatedAt })); }],
    ['guest DB', async (updatedAt: number) => { await (await getLocalDb('justwriting-local')).put('drafts', { userId: 'guest_draft', content: 'старый', updatedAt } as any); }],
  ])('S-44.4: a draft older than 7 days in %s is not counted', async (_where, seed) => {
    vi.spyOn(authModule, 'getCurrentUser').mockReturnValue({ uid: 'user_signed_in_s8', email: 'user@example.com' } as any);
    await seed(Date.now() - 8 * 24 * 60 * 60 * 1000);

    expect(await checkGuestDocuments()).toBeNull();
  });
});
