import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';

/**
 * DEEP-P2: вкладка, пережившая выкатку.
 *
 * Соседняя вкладка обновилась и подняла схему; эта работает на старом бандле и
 * открывает базу с номером версии ниже, чем на устройстве. IndexedDB отвечает
 * VersionError. Раньше ошибка уходила только в reportError, а человек видел
 * пустой архив — ровно так читалась пропажа заметок на бампе v6.
 *
 * Проверяется, что человеку говорят, что делать. Фальсификация: убрать ветку
 * VersionError в getLocalDb — оверлея нет, тест краснеет.
 */

vi.mock('../../auth', () => ({ getCurrentUser: () => null }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const DB_NAME = 'justwriting-local';

describe('база новее, чем знает этот бандл', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    await deleteDB(DB_NAME).catch(() => { /* первой запуск — базы нет */ });
    vi.resetModules();
  });

  it('показывает, что нужно обновить страницу, и не молчит', async () => {
    // Версия заведомо выше той, что зашита в getLocalDb.
    const ahead = await openDB(DB_NAME, 99);
    ahead.close();

    const { getLocalDb } = await import('../localDb');
    await expect(getLocalDb()).rejects.toThrow();

    const overlay = document.getElementById('db-upgrade-blocked-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain('Обновите страницу');
  });

  // DA-14: соседняя вкладка поднимает схему — эта закрывает базу и сразу
  // говорит об этом, а не падает на следующей записи общей ошибкой.
  it('при обновлении схемы в другой вкладке сразу показывает оверлей', async () => {
    const { getLocalDb } = await import('../localDb');
    await getLocalDb();
    expect(document.getElementById('db-upgrade-blocked-overlay')).toBeNull();

    const newer = await openDB(DB_NAME, 99);
    newer.close();

    const overlay = document.getElementById('db-upgrade-blocked-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain('обновилось в другой вкладке');
  });
});
