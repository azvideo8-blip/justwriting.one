// TEST-1 §2.8: after migration the guest draft is consumed — the source row is
// gone and the localStorage copy is cleared, so the migration prompt cannot
// reappear and the draft cannot resurface as a ghost on the next guest session.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getLocalDb, getOrCreateGuestId } from '../../../../core/storage/localDb';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { LocalStorageService } from '../../../../core/services/LocalStorageService';
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

  // Ревью 0.11.6: эпоха гостя не имеет смысла в карте аккаунта. С ней выгрузка по
  // `draft.migrated` отвергалась как устаревшая, и черновик не уходил в облако.
  it('does not carry the guest epoch into the account row', async () => {
    const guestDb = await getLocalDb();
    await guestDb.put('drafts', { userId: 'guest_draft', content: 'черновик', epoch: 0, updatedAt: Date.now() } as never);

    await migrateDocuments('user_epoch');

    const userDraft = await (await getLocalDb('user_epoch')).get('drafts', 'user_epoch');
    expect((userDraft as { content?: string })?.content).toBe('черновик');
    expect((userDraft as { epoch?: number })?.epoch).toBeUndefined();
  });

  // S-55: у аккаунта уже есть черновик — гостевой не выбрасывается под
  // «перенесено 1», а становится обычной заметкой «Черновик гостя, <дата>».
  it('S-55: when the user already has a draft, the guest draft becomes a note instead of being deleted', async () => {
    const guestDb = await getLocalDb();
    const userDb = await getLocalDb('user_2');
    // От даты черновика зависит и заголовок заметки, и TTL: readGuestDraft
    // (migrateDocuments.ts:42) отсекает всё старше 7 дней, поэтому дата
    // относительно «сейчас», а не литерал — иначе тест гаснет через неделю.
    const at = Date.now() - 2 * 24 * 60 * 60 * 1000;
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

  // S-63.5: черновик только с названием удалялся без сохранения; своё название
  // черновика выбрасывалось в пользу «Черновик гостя, <дата>».
  it('S-63: a title-only guest draft becomes a note under its own title', async () => {
    const guestDb = await getLocalDb();
    const userDb = await getLocalDb('user_s63');
    await guestDb.put('drafts', { userId: 'guest_draft', title: 'Только название', content: '', wordCount: 0, seconds: 0, wpm: 0, updatedAt: Date.now() } as never);
    await userDb.put('drafts', { userId: 'user_s63', content: 'свой черновик', updatedAt: Date.now() } as never);

    const result = await migrateDocuments('user_s63');

    expect((await userDb.getAll('documents')).map(n => n.title), 'черновик без текста выброшен').toEqual(['Только название']);
    expect(await guestDb.get('drafts', 'guest_draft')).toBeUndefined();
    expect(result).toEqual({ moved: 1, left: 0 });
  });

  it('S-63: the draft-note counts in «moved» next to the notes', async () => {
    const guestDb = await getLocalDb();
    const userDb = await getLocalDb('user_s63b');
    const guestId = getOrCreateGuestId();
    for (const title of ['Раз', 'Два']) await LocalDocumentService.createDocument(guestId, { title });
    await guestDb.put('drafts', { userId: 'guest_draft', title: 'Черновик', content: 'текст черновика', wordCount: 2, seconds: 0, wpm: 0, updatedAt: Date.now() } as never);
    await userDb.put('drafts', { userId: 'user_s63b', content: 'свой черновик', updatedAt: Date.now() } as never);

    const result = await migrateDocuments('user_s63b');

    expect((await userDb.getAll('documents')).map(n => n.title).sort()).toEqual(['Два', 'Раз', 'Черновик']);
    expect(result).toEqual({ moved: 3, left: 0 });
  });

  // S-55 survivor (S-63): заметка не сохранилась — черновик не удаляется.
  it('S-55 survivor: a failed saveNew keeps the guest draft in both stores', async () => {
    const guestDb = await getLocalDb();
    const userDb = await getLocalDb('user_s63c');
    await guestDb.put('drafts', { userId: 'guest_draft', content: 'текст, который нельзя терять', wordCount: 3, seconds: 0, wpm: 0, updatedAt: Date.now() } as never);
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({ content: 'текст, который нельзя терять', updatedAt: Date.now() }));
    await userDb.put('drafts', { userId: 'user_s63c', content: 'свой черновик', updatedAt: Date.now() } as never);
    const spy = vi.spyOn(LocalStorageService, 'saveNew').mockRejectedValue(new Error('IDB full'));
    try {
      await expect(migrateDocuments('user_s63c')).rejects.toThrow('IDB full');
    } finally {
      spy.mockRestore();
    }
    expect(await guestDb.get('drafts', 'guest_draft'), 'черновик удалён без сохранённой заметки').toBeDefined();
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).not.toBeNull();
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
