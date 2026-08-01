import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { LocalDocumentService } from '../LocalDocumentService';

const NOTE = 'local_unlink_me';

async function seed() {
  const db = await getLocalDb();
  for (const rec of await db.getAll('documents')) await db.delete('documents', (rec as { id: string }).id);
  await db.put('documents', {
    id: NOTE, guestId: 'u1', title: 'n', currentVersion: 1, totalWords: 1,
    totalDuration: 0, sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000,
    tags: [], linkedCloudId: 'cloud_1',
  } as never);
  return db;
}

// Removing a note from the cloud is a decision, not an accident. Clearing only
// the link left it indistinguishable from a note whose link was LOST, and the
// re-link pass then matched it back by firstSessionAt and restored the very copy
// the user had just deleted.
describe('deliberate unlink is remembered', () => {
  beforeEach(seed);

  it('marks the note local-only, so the re-link pass leaves it alone', async () => {
    const db = await getLocalDb();

    await LocalDocumentService.unlinkFromCloud(NOTE);

    const after = await db.get('documents', NOTE);
    expect(after?.linkedCloudId).toBe('');
    expect(after?.localOnly).toBe(true);
  });

  it('plain updateLinkedCloudId does NOT mark intent — it is for a lost link', async () => {
    const db = await getLocalDb();

    await LocalDocumentService.updateLinkedCloudId(NOTE, '');

    const after = await db.get('documents', NOTE);
    expect(after?.localOnly).toBeUndefined();
  });
});
