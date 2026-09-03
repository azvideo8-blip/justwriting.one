import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';

/**
 * Переезд со старой общей базы `justwriting-local` на базу аккаунта.
 *
 * Это самая опасная функция во всей правке: она копирует весь архив человека в
 * другую базу и удаляет оригиналы. У неё не было ни одного теста.
 *
 * Проверяется здесь не «копирует», а «не теряет»: копирование по хранилищам
 * обёрнуто в try/catch, который только пишет предупреждение, а удаление
 * оригиналов идёт следом безусловно. Провал копирования плюс состоявшееся
 * удаление — это архив, которого больше нет нигде.
 */

const UID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

vi.mock('../../auth', () => ({ getCurrentUser: () => ({ uid: UID }) }));

const { getLocalDb, getLocalDbName } = await import('../localDb');

function doc(id: string, guestId: string) {
  return {
    id, uuid: `uuid-${id}`, guestId, title: id,
    currentVersion: 1, totalWords: 10, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: 1, lastSessionAt: 1, tags: [],
  };
}

async function seedLegacy(records: ReturnType<typeof doc>[], extra?: (db: never) => Promise<void>) {
  const db = await getLocalDb('justwriting-local');
  for (const r of await db.getAll('documents')) await db.delete('documents', r.id);
  for (const r of records) await db.put('documents', r as never);
  if (extra) await extra(db as never);
}

describe('переезд со старой общей базы', () => {
  beforeEach(async () => {
    localStorage.clear();
    await deleteDB(`justwriting-local-${UID}`).catch(() => {});
  });

  it('база аккаунта названа его номером, а не общим именем', () => {
    expect(getLocalDbName()).toBe(`justwriting-local-${UID}`);
    expect(getLocalDbName('justwriting-local')).toBe('justwriting-local');
  });

  it('заметки человека переезжают в его базу', async () => {
    await seedLegacy([doc('local_1', UID), doc('local_2', UID)]);

    const userDb = await getLocalDb(UID);
    const moved = await userDb.getAll('documents');

    expect(moved.map(d => d.id).sort()).toEqual(['local_1', 'local_2']);
  });

  /**
   * Ключевое свойство. Если копирование не удалось, оригиналы обязаны остаться
   * на месте: у человека 171 заметка, и второго источника у них нет.
   */
  it('оригиналы не удаляются, когда копирование не удалось', async () => {
    await seedLegacy([doc('local_1', UID), doc('local_2', UID)]);

    // Целевая база существует, но БЕЗ хранилища documents: запись в неё упадёт.
    // Так выглядит любой сбой копирования — квота, прерванная транзакция,
    // несовпадение схемы.
    const broken = await openDB(`justwriting-local-${UID}`, 21, {
      upgrade(db) {
        for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
        db.createObjectStore('drafts', { keyPath: 'userId' });
      },
    });
    broken.close();

    await getLocalDb(UID).catch(() => undefined);

    const legacy = await getLocalDb('justwriting-local');
    const left = await legacy.getAll('documents');
    expect(
      left.map(d => d.id).sort(),
      'заметки должны остаться в старой базе, раз в новую они не доехали',
    ).toEqual(['local_1', 'local_2']);
  });

  /**
   * Вторая половина той же защиты, и её надо проверять отдельно: копирование
   * заметок прошло, а копирование другого хранилища упало. Проверка «сходится
   * ли число заметок» этого не заметит — заметит только флаг сбоя.
   */
  it('оригиналы не удаляются, когда упало копирование любого другого хранилища', async () => {
    await seedLegacy([doc('local_1', UID)], async (db) => {
      await (db as unknown as { put(s: string, v: unknown): Promise<unknown> })
        .put('versions', {
          id: 'ver_1', documentId: 'local_1', guestId: UID, version: 1,
          content: 'текст', wordCount: 1, wordsAdded: 1, charsAdded: 5,
          duration: 1, wpm: 1, createdAt: 1,
        });
    });

    // В целевой базе есть documents, но нет versions: заметки скопируются,
    // версии — нет.
    const partial = await openDB(`justwriting-local-${UID}`, 21, {
      upgrade(db) {
        for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
        db.createObjectStore('documents', { keyPath: 'id' });
      },
    });
    partial.close();

    await getLocalDb(UID).catch(() => undefined);

    const legacy = await getLocalDb('justwriting-local');
    const left = await legacy.getAll('documents');
    expect(
      left.map(d => d.id),
      'раз уехало не всё, оригиналы должны остаться',
    ).toEqual(['local_1']);
  });

  /**
   * Портрет, убеждения и память чата лежат без пометки владельца. Когда в общей
   * базе есть заметки ДВУХ аккаунтов, приписать эти записи кому-то одному
   * нельзя — а копирование их тому, кто вошёл первым, воспроизводит ровно ту
   * утечку, ради которой всю базу и разделяли.
   */
  it('не забирает записи без владельца, когда в общей базе жили два аккаунта', async () => {
    const OTHER = 'ffffffff-1111-4222-8333-444444444444';
    await seedLegacy([doc('local_1', UID), doc('local_other', OTHER)], async (db) => {
      await (db as unknown as { put(s: string, v: unknown): Promise<unknown> })
        .put('aiPortrait', { id: 'singleton', portrait: 'портрет неизвестно чей', updatedAt: 1 });
    });

    const userDb = await getLocalDb(UID);
    const portrait = await userDb.get('aiPortrait', 'singleton');

    expect(portrait, 'портрет без владельца не должен достаться никому').toBeUndefined();
  });
});
