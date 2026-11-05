// DW6-3 (D13 из карты §1.3): просроченный гостевой черновик не переносился и не
// удалялся. `readGuestDraft` (`migrateDocuments.ts:42`) отдаёт null по TTL, а весь
// блок стирания гостевых адресов живёт внутри `if (guestDraft && …)` — строки
// `guest_draft` и `jw_guest_draft` оставались в хранилищах навсегда (их больше
// никто не читает: вход сделан, гостевой редактор закрыт).
// Должно быть: просроченный — удалён; аккаунтов черновик по чужим часам не
// удаляется (D1-6, закрыто `draftExpiryServerClock.d1-6.test.ts`).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import { getLocalDb } from '../../../../core/storage/localDb';
import { GUEST_DRAFT_TTL_MS, STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { migrateDocuments } from '../migrateDocuments';

const DAY = 24 * 60 * 60 * 1000;
const EXPIRED = Date.now() - GUEST_DRAFT_TTL_MS - 2 * DAY;

beforeEach(async () => {
  localStorage.clear();
  const db = await getLocalDb();
  const tx = db.transaction(['drafts', 'documents', 'versions'], 'readwrite');
  await Promise.all([
    tx.objectStore('drafts').clear(),
    tx.objectStore('documents').clear(),
    tx.objectStore('versions').clear(),
  ]);
  await tx.done;
});

describe('DW6-3 (D13): просроченный гостевой черновик удаляется при входе', () => {
  it('обе гостевых копии старше TTL стёрты, и переноса нет', async () => {
    const guestDb = await getLocalDb();
    await guestDb.put('drafts', {
      userId: 'guest_draft', content: 'ПРОСРОЧЕНЫЙ_ГОСТЕВОЙ_ТЕКСТ_D13', wordCount: 3, updatedAt: EXPIRED,
    } as never);
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({
      userId: 'guest_draft', content: 'ПРОСРОЧЕНЫЙ_ГОСТЕВОЙ_ТЕКСТ_D13', wordCount: 3, updatedAt: EXPIRED,
    }));

    const res = await migrateDocuments('u_d13');

    expect(await guestDb.get('drafts', 'guest_draft')).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).toBeNull();
    const userDb = await getLocalDb('u_d13');
    expect(await userDb.get('drafts', 'u_d13')).toBeUndefined();
    expect(res.moved).toBe(0);
  });

  // Зелёный контроль: свежий гостевой черновик TTL не задевает — он переносится,
  // а не стирается (S-44.4, S-55).
  it('свежий гостевой черновик переносится, а не удаляется по сроку', async () => {
    const fresh = Date.now() - DAY;
    const guestDb = await getLocalDb();
    await guestDb.put('drafts', {
      userId: 'guest_draft', content: 'СВЕЖИЙ_ГОСТЕВОЙ_ТЕКСТ_D13', wordCount: 3, updatedAt: fresh,
    } as never);

    await migrateDocuments('u_d13_fresh');

    const userDb = await getLocalDb('u_d13_fresh');
    expect(((await userDb.get('drafts', 'u_d13_fresh')) as { content?: string })?.content).toBe('СВЕЖИЙ_ГОСТЕВОЙ_ТЕКСТ_D13');
  });
});
