import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../auth', () => ({ getCurrentUser: () => ({ uid: 'u_wipe' }) }));

import { getLocalDb, clearAllLocalStores } from '../localDb';

// R3-3: перенос гостевых заметок оставляет их (перепривязанными к аккаунту) в
// общей базе браузера; «стереть всё с этого компьютера» их не трогало.
describe('R3-3: wiping an account also clears its records in the shared browser database', () => {
  beforeEach(async () => {
    const shared = await getLocalDb('justwriting-local');
    for (const s of ['documents', 'versions', 'drafts'] as const) await shared.clear(s);
  });

  it('removes the account notes, versions and draft from justwriting-local, keeps others', async () => {
    const shared = await getLocalDb('justwriting-local');
    await shared.put('documents', { id: 'd1', guestId: 'u_wipe', title: 'Дневник', currentVersion: 1 } as never);
    await shared.put('versions', { id: 'v1', documentId: 'd1', guestId: 'u_wipe', version: 1, content: 'текст' } as never);
    await shared.put('drafts', { userId: 'u_wipe', content: 'черновик' } as never);
    await shared.put('documents', { id: 'd2', guestId: 'guest_other', title: 'Чужое', currentVersion: 1 } as never);

    await clearAllLocalStores('u_wipe');

    const after = await getLocalDb('justwriting-local');
    expect(await after.get('documents', 'd1')).toBeUndefined();
    expect(await after.get('versions', 'v1')).toBeUndefined();
    expect(await after.get('drafts', 'u_wipe')).toBeUndefined();
    expect(await after.get('documents', 'd2')).toBeDefined();
  });
});
