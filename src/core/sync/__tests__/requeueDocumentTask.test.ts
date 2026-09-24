import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { requeueDocumentTask } from '../requeueDocumentTask';

// R3-6: повторная постановка в очередь стирала attempts/dead — карантин после
// MAX_ATTEMPTS не наступал, и безнадёжная задача крутилась вечно.
describe('R3-6: requeueing keeps the task history', () => {
  beforeEach(async () => { await (await getLocalDb()).clear('syncQueue'); });

  it('keeps attempts, dead and lastError of an existing task', async () => {
    const db = await getLocalDb();
    await db.put('syncQueue', { id: 'sync_d1', documentId: 'd1', type: 'document', createdAt: 1, ownerId: 'u', attempts: 7, dead: true, lastError: 'SYNC_UNRESOLVED' });
    await requeueDocumentTask('d1', 'u');
    expect(await db.get('syncQueue', 'sync_d1')).toMatchObject({ attempts: 7, dead: true, lastError: 'SYNC_UNRESOLVED', createdAt: 1 });
  });

  it('creates a fresh task when there is none', async () => {
    await requeueDocumentTask('d2', 'u');
    const task = await (await getLocalDb()).get('syncQueue', 'sync_d2');
    expect(task).toMatchObject({ documentId: 'd2', type: 'document', ownerId: 'u' });
    expect(task?.attempts).toBeUndefined();
  });
});
