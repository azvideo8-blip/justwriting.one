// TEST-1 §2.8: after migration the guest draft is consumed — the source row is
// gone and the localStorage copy is cleared, so the migration prompt cannot
// reappear and the draft cannot resurface as a ghost on the next guest session.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import { getLocalDb } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { migrateDocuments, readGuestDraft } from '../migrateDocuments';

beforeEach(async () => {
  localStorage.clear();
  const db = await getLocalDb();
  // fresh stores per test: clear the two stores we touch
  const tx = db.transaction(['drafts', 'documents', 'versions'], 'readwrite');
  await Promise.all([
    tx.objectStore('drafts').clear(),
    tx.objectStore('documents').clear(),
    tx.objectStore('versions').clear(),
  ]);
  await tx.done;
});

describe('2.8 guest draft is consumed by migration', () => {
  it('copies to the user, deletes the source and clears the localStorage copy', async () => {
    const guestDb = await getLocalDb();
    await guestDb.put('drafts', {
      userId: 'guest_draft',
      content: 'черновик гостя до входа',
      updatedAt: Date.now(),
    } as never);
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, 'остаток в localStorage');

    const moved = await migrateDocuments('user_1');

    // The user now owns the draft in userDb…
    const userDb = await getLocalDb('user_1');
    const userDraft = await userDb.get('drafts', 'user_1');
    expect((userDraft as { content?: string })?.content).toBe('черновик гостя до входа');
    // …and the source is consumed either way, with no copy left in guestDb.
    expect(await guestDb.get('drafts', 'guest_draft')).toBeUndefined();
    expect(await guestDb.get('drafts', 'user_1')).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).toBeNull();
    expect(moved.moved).toBeGreaterThanOrEqual(0);
  });

  // S-55: у аккаунта уже есть черновик — гостевой не выбрасывается под
  // «перенесено 1», а становится обычной заметкой «Черновик гостя, <дата>».
  it('S-55: when the user already has a draft, the guest draft becomes a note instead of being deleted', async () => {
    const guestDb = await getLocalDb();
    const userDb = await getLocalDb('user_2');
    const at = Date.parse('2026-10-02T10:00:00+05:00');
    await guestDb.put('drafts', { userId: 'guest_draft', content: 'гостевой текст, который нельзя терять', wordCount: 5, seconds: 40, wpm: 7, updatedAt: at } as never);
    await userDb.put('drafts', { userId: 'user_2', content: 'уже был черновик', updatedAt: Date.now() } as never);

    const result = await migrateDocuments('user_2');

    expect(await guestDb.get('drafts', 'guest_draft')).toBeUndefined();
    expect(await guestDb.get('drafts', 'user_2')).toBeUndefined();
    expect(((await userDb.get('drafts', 'user_2')) as { content: string }).content).toBe('уже был черновик');
    const notes = await userDb.getAll('documents');
    expect(notes.map(n => n.title)).toEqual([`Черновик гостя, ${new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`]);
    const versions = await userDb.getAll('versions');
    expect(versions.map(v => v.content)).toEqual(['гостевой текст, который нельзя терять']);
    expect(notes[0]!.firstSessionAt).toBe(at);
    expect(result).toEqual({ moved: 1, left: 0 });
  });

  it('S-55: the legacy `timestamp` field counts like updatedAt — for the newer-copy rule and for the 7-day TTL', async () => {
    const guestDb = await getLocalDb();
    await guestDb.put('drafts', { userId: 'guest_draft', content: 'старая копия в IDB', updatedAt: Date.now() - 60_000 } as never);
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({ content: 'свежий старый черновик', timestamp: Date.now() - 1000 }));
    expect((await readGuestDraft(guestDb))?.content, 'копия с timestamp сочтена нулевого возраста и проиграла').toBe('свежий старый черновик');

    await guestDb.delete('drafts', 'guest_draft');
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({ content: 'протухший', timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000 }));
    expect(await readGuestDraft(guestDb), 'черновик старше 7 дней по timestamp должен быть пропущен, как в GuestDraftService').toBeNull();
  });

  it('S-55 survivor: the newer of the two copies wins — localStorage over IndexedDB when it is fresher', async () => {
    const guestDb = await getLocalDb();
    await guestDb.put('drafts', { userId: 'guest_draft', content: 'старая копия в IDB', updatedAt: Date.now() - 60_000 } as never);
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({ content: 'свежая копия в localStorage', updatedAt: Date.now() }));

    expect((await readGuestDraft(guestDb))?.content).toBe('свежая копия в localStorage');
  });

  // S-44.4: окно переноса считает и копию из localStorage — значит, перенос
  // обязан её перенести, иначе «перенесено 1» при moved: 0 и окно на каждой загрузке.
  it('S-44.4: moves a draft that lives only in localStorage and counts it', async () => {
    const guestDb = await getLocalDb();
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({ content: 'только в localStorage', updatedAt: Date.now() }));

    const result = await migrateDocuments('user_3');

    const userDraft = await (await getLocalDb('user_3')).get('drafts', 'user_3');
    expect((userDraft as { content?: string })?.content).toBe('только в localStorage');
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).toBeNull();
    expect(await guestDb.get('drafts', 'guest_draft')).toBeUndefined();
    expect(result).toEqual({ moved: 1, left: 0 });
  });
});
