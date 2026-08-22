import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDB, deleteDB } from 'idb';
import { getLocalDb, resetDbInstance } from '../localDb';

/**
 * D4.17 убрал картотеку упомянутых людей. Перестать писать имена мало —
 * накопленное нужно снести, иначе имена и характер отношений остаются лежать
 * на устройстве после «удаления» функции. Обход по сводкам синхронный и
 * молчаливый: если он отвалится, никто не заметит, а имена останутся.
 */
const DB_NAME = 'justwriting-local';

async function seedLegacyDb() {
  const db = await openDB(DB_NAME, 19, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('aiPeopleIndex')) {
        database.createObjectStore('aiPeopleIndex', { keyPath: 'name' });
      }
      if (!database.objectStoreNames.contains('aiSummaries')) {
        database.createObjectStore('aiSummaries', { keyPath: 'documentId' });
      }
    },
  });
  await db.put('aiPeopleIndex', { name: 'Анна', noteIds: ['n1'], mentionCount: 2 });
  await db.put('aiSummaries', {
    documentId: 'n1',
    summary: 'разговор',
    mentionedPeople: [{ name: 'Анна', role: 'терапевт' }],
  });
  await db.put('aiSummaries', { documentId: 'n2', summary: 'без людей' });
  db.close();
}

describe('localDb: миграция на 20 сносит картотеку людей', () => {
  beforeEach(async () => {
    resetDbInstance();
    await deleteDB(DB_NAME);
  });

  afterEach(async () => {
    resetDbInstance();
    await deleteDB(DB_NAME);
  });

  it('удаляет стор aiPeopleIndex и вычищает mentionedPeople из сводок', async () => {
    await seedLegacyDb();

    const db = await getLocalDb();
    expect(db.objectStoreNames.contains('aiPeopleIndex' as never)).toBe(false);

    // Обход курсором идёт внутри транзакции обновления, но не ожидается
    // вызывающим — дожидаемся результата, а не фиксированного тика.
    await vi.waitFor(async () => {
      const n1 = await db.get('aiSummaries', 'n1');
      expect(n1).toBeDefined();
      expect('mentionedPeople' in (n1 as object)).toBe(false);
    });

    const n1 = await db.get('aiSummaries', 'n1') as { summary: string };
    expect(n1.summary).toBe('разговор');
    const n2 = await db.get('aiSummaries', 'n2') as { summary: string };
    expect(n2.summary).toBe('без людей');
  });

  it('на чистой базе открывается без картотеки людей', async () => {
    const db = await getLocalDb();
    expect(db.objectStoreNames.contains('aiPeopleIndex' as never)).toBe(false);
    expect(db.objectStoreNames.contains('aiSummaries')).toBe(true);
  });
});
