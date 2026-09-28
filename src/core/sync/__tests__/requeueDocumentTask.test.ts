import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { requeueDocumentTask } from '../requeueDocumentTask';

// R3-6: повторная постановка в очередь стирала attempts/dead — карантин после
// MAX_ATTEMPTS не наступал, и безнадёжная задача крутилась вечно.
describe('R3-6: requeueing keeps the task history', () => {
  beforeEach(async () => { await (await getLocalDb('u')).clear('syncQueue'); });

  it('keeps attempts, dead and lastError, keeps createdAt, bumps updatedAt', async () => {
    const db = await getLocalDb('u');
    await db.put('syncQueue', { id: 'sync_d1', documentId: 'd1', type: 'document', createdAt: 1, ownerId: 'u', attempts: 7, dead: true, lastError: 'SYNC_UNRESOLVED' });
    await requeueDocumentTask('d1', 'u');
    const task = await db.get('syncQueue', 'sync_d1');
    // Повтор не обнуляет бюджет попыток и не снимает карантин (R3-6);
    // новая правка делает это через addToSyncQueue.
    expect(task).toMatchObject({ attempts: 7, dead: true, lastError: 'SYNC_UNRESOLVED', createdAt: 1 });
    // A-2.1 (F-021): снимок дренажа обязан увидеть повторную постановку.
    expect(task?.updatedAt).toBeTypeOf('number');
  });

  it('creates a fresh task when there is none', async () => {
    await requeueDocumentTask('d2', 'u');
    const task = await (await getLocalDb('u')).get('syncQueue', 'sync_d2');
    expect(task).toMatchObject({ documentId: 'd2', type: 'document', ownerId: 'u' });
    expect(task?.attempts ?? 0).toBe(0);
  });
});
