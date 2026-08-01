import { getOrCreateGuestId, getLocalDb } from '../../../core/storage/localDb';

/**
 * Re-keys this device's guest notes, versions and draft onto a signed-in
 * account. Lives outside MigrationPrompt.tsx so the tests can run the real
 * thing: a copy of it in the test file drifted from production and kept
 * passing while the code it was meant to cover was wrong.
 */
export async function migrateDocuments(userId: string): Promise<number> {
  const guestId = getOrCreateGuestId();
  const db = await getLocalDb();
  const hasDrafts = db.objectStoreNames.contains('drafts');
  const tx = db.transaction(
    hasDrafts ? ['documents', 'versions', 'drafts'] : ['documents', 'versions'],
    'readwrite',
  );
  const docStore = tx.objectStore('documents');
  const verStore = tx.objectStore('versions');
  const draftStore = hasDrafts ? tx.objectStore('drafts') : null;

  const guestDocs = await docStore.index('by-guest').getAll(guestId);

  // D-3: migrate guest draft to user draft (don't clobber existing user draft).
  // A8: the guest draft is keyed by the literal 'guest_draft' — the key
  // GuestDraftService writes. Reading it by guestId found nothing, so the
  // unsaved text on screen at sign-in was quietly left behind.
  const draftPuts: Promise<unknown>[] = [];
  if (draftStore) {
    const guestDraft = await draftStore.get('guest_draft');
    if (guestDraft) {
      const existingUserDraft = await draftStore.get(userId);
      if (!existingUserDraft) {
        draftPuts.push(draftStore.put({ ...guestDraft, userId }));
      }
    }
  }

  if (guestDocs.length === 0) {
    await Promise.all([...draftPuts, tx.done]);
    return 0;
  }

  const verIndex = verStore.index('by-document');
  const versionPuts: Promise<string>[] = [];
  for (const doc of guestDocs) {
    let cursor = await verIndex.openCursor(doc.id);
    while (cursor) {
      if (cursor.value.guestId === guestId) {
        versionPuts.push(verStore.put({ ...cursor.value, guestId: userId }));
      }
      cursor = await cursor.continue();
    }
  }

  await Promise.all([
    ...guestDocs.map(doc => docStore.put({ ...doc, guestId: userId })),
    ...versionPuts,
    ...draftPuts,
    tx.done,
  ]);

  return guestDocs.length;
}
