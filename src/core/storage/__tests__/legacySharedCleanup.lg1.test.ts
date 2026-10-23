// LG-1: у мигрировавших до 88cbc35b в общей базе остались версии, профиль и
// ИИ-хранилища аккаунта; повторный вход выходил на `docs.length === 0` без чистки.
//
// Мутации: убрать фильтр по documentId у версий → (a) красный (гостевая версия
// удалена); убрать проверку pending → (c) красный; глотать ошибку чтения как
// «пусто» → (b) красный; убрать `isGuestOwner` у версий → (f) красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../auth', () => ({ getCurrentUser: () => ({ uid: 'u_lg' }) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { getLocalDb, cleanLegacySharedDb } from '../localDb';
import { reportError } from '../../../shared/errors/reportError';

async function seed() {
  const shared = await getLocalDb('justwriting-local');
  for (const s of ['documents', 'versions', 'drafts', 'profile', 'aiSummaries', 'aiPortrait'] as const) await shared.clear(s);
  await shared.put('aiSummaries', { documentId: 'gone', summary: 'СУТЬ' } as never);
  await shared.put('aiPortrait', { id: 'singleton', text: 'портрет' } as never);
  await shared.put('versions', { id: 'v_orphan', documentId: 'gone', guestId: 'u_old', version: 1, content: 'текст' } as never);
  await shared.put('profile', { guestId: 'u_old', totalWords: 1 } as never);
  await shared.put('profile', { guestId: 'guest_x', totalWords: 2 } as never);
  await shared.put('documents', { id: 'g1', guestId: 'guest_x', title: 'гость', currentVersion: 1 } as never);
  await shared.put('versions', { id: 'gv1', documentId: 'g1', guestId: 'guest_x', version: 1, content: 'гостевой' } as never);
  await shared.put('drafts', { userId: 'guest_x', content: 'черновик' } as never);
  return shared;
}

describe('LG-1: остаток аккаунта в общей базе устройства', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(reportError).mockClear();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('(a) открытие базы аккаунта чистит ИИ, сирот и чужой профиль; гостевое на месте', async () => {
    await seed();
    localStorage.setItem('jw_legacy_migrated_u_lg', '1');
    await getLocalDb('u_lg');

    const s = await getLocalDb('justwriting-local');
    expect(await s.count('aiSummaries')).toBe(0);
    expect(await s.count('aiPortrait')).toBe(0);
    expect(await s.get('versions', 'v_orphan')).toBeUndefined();
    expect(await s.get('profile', 'u_old')).toBeUndefined();
    expect(await s.get('documents', 'g1')).toBeDefined();
    expect(await s.get('versions', 'gv1')).toBeDefined();
    expect(await s.get('drafts', 'guest_x')).toBeDefined();
    expect(await s.get('profile', 'guest_x')).toBeDefined();
    expect(localStorage.getItem('jw_shared_db_cleaned_v1')).toBe('1');
  });

  it('(b) чтение документов упало → ничего не удалено, флага нет', async () => {
    const shared = await seed();
    const realTx = shared.transaction.bind(shared) as (...a: unknown[]) => ReturnType<typeof shared.transaction>;
    vi.spyOn(shared, 'transaction').mockImplementation(((...args: unknown[]) => {
      const tx = realTx(...args);
      if (args[1] === 'readwrite') vi.spyOn(tx.objectStore('documents'), 'getAll').mockRejectedValueOnce(new Error('read failed'));
      return tx;
    }) as never);
    await cleanLegacySharedDb();

    expect(await shared.count('aiSummaries')).toBe(1);
    expect(await shared.get('versions', 'v_orphan')).toBeDefined();
    expect(localStorage.getItem('jw_shared_db_cleaned_v1')).toBeNull();
    expect(reportError).toHaveBeenCalled();
  });

  it('(c) документы аккаунта ждут миграции → его ИИ и профиль остаются, сироты уходят', async () => {
    const shared = await seed();
    await shared.put('documents', { id: 'b1', guestId: 'u_old', title: 'B', currentVersion: 1 } as never);
    await cleanLegacySharedDb();

    expect(await shared.count('aiSummaries')).toBe(1);
    expect(await shared.get('profile', 'u_old')).toBeDefined();
    expect(await shared.get('versions', 'v_orphan')).toBeUndefined();
    expect(localStorage.getItem('jw_shared_db_cleaned_v1')).toBeNull();
  });

  // R-10: другая вкладка сохраняет документ+версию между снимком documents и
  // курсором по versions. Мутация «читать documents отдельной транзакцией» →
  // (d) красный: версия u_other не в снимке → удалена как сирота.
  async function injectSaveBeforeCleanupTx(shared: Awaited<ReturnType<typeof getLocalDb>>, owner: string) {
    // Шорткаты idb (`shared.getAll`) тоже зовут transaction(), поэтому ждём именно readwrite.
    const realTx = shared.transaction.bind(shared) as typeof shared.transaction;
    let injected = false;
    vi.spyOn(shared, 'transaction').mockImplementation(((...args: unknown[]) => {
      if (args[1] === 'readwrite' && !injected) {
        injected = true;
        // Очередь IndexedDB: транзакция, созданная раньше с пересекающимся scope, идёт первой.
        const save = realTx(['documents', 'versions'], 'readwrite');
        void save.objectStore('documents').put({ id: 'dnew', guestId: owner, title: 'новая', currentVersion: 1 } as never);
        void save.objectStore('versions').put({ id: 'vnew', documentId: 'dnew', guestId: owner, version: 1, content: 'единственный текст' } as never);
      }
      return (realTx as (...a: unknown[]) => unknown)(...args);
    }) as never);
  }

  it('(d) сохранение аккаунта между снимком и курсором → версия на месте', async () => {
    const shared = await seed();
    await injectSaveBeforeCleanupTx(shared, 'u_other');
    await cleanLegacySharedDb('u_lg');
    expect(await shared.get('documents', 'dnew')).toBeDefined();
    expect(await shared.get('versions', 'vnew')).toBeDefined();
  });

  it('(d2) гостевое сохранение между снимком и курсором → версия на месте', async () => {
    const shared = await seed();
    await injectSaveBeforeCleanupTx(shared, 'guest_y');
    await cleanLegacySharedDb('u_lg');
    expect(await shared.get('versions', 'vnew')).toBeDefined();
  });

  // R-11: миграция отмечена сделанной, а документ текущего аккаунта всё ещё в
  // общей базе → чистка не наступит никогда. Один reportError, без прохода по версиям.
  // Мутация «убрать отметку в localStorage» → второй вызов репортит снова → красный.
  it('(e) документ текущего аккаунта при сделанной миграции → один reportError, версии не трогаем', async () => {
    const shared = await seed();
    await shared.put('documents', { id: 'mine', guestId: 'u_lg', title: 'застрял', currentVersion: 1 } as never);
    localStorage.setItem('jw_legacy_migrated_u_lg', '1');
    await cleanLegacySharedDb('u_lg');
    await cleanLegacySharedDb('u_lg');

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(await shared.get('versions', 'v_orphan')).toBeDefined();
    expect(await shared.count('aiSummaries')).toBe(1);
    expect(localStorage.getItem('jw_shared_db_cleaned_v1')).toBeNull();
  });

  it('(f) гостевая версия без своего документа в снимке переживает чистку', async () => {
    const shared = await seed();
    // Гостевая версия, чей документ ещё не в снимке (или лежит у гостя иначе), —
    // гостевое не трогаем, даже без пары.
    await shared.put('versions', { id: 'gv_lonely', documentId: 'g_absent', guestId: 'guest_x', version: 1, content: 'гостевой текст' } as never);
    localStorage.setItem('jw_legacy_migrated_u_lg', '1');
    await cleanLegacySharedDb('u_lg');

    const s = await getLocalDb('justwriting-local');
    expect(await s.get('versions', 'gv_lonely')).toBeDefined();
    expect(await s.get('versions', 'v_orphan'), 'сирота аккаунта — уходит').toBeUndefined();
  });

  // А-4 (аддон дейлика 2026-10-23): пока в общей базе лежат документы аккаунта,
  // который сюда не входил, флаг не ставится — и каждое открытие базы поднимало
  // readwrite-транзакцию с курсорами по чужим версиям. Мутация: убрать выход по
  // запомненному составу → красный.
  it('(g) чистить нечего и состав не менялся → повторные вызовы без readwrite; новая версия → проход', async () => {
    const shared = await seed();
    await shared.put('documents', { id: 'b1', guestId: 'u_old', title: 'B', currentVersion: 1 } as never);
    await cleanLegacySharedDb();
    const realTx = shared.transaction.bind(shared) as (...a: unknown[]) => ReturnType<typeof shared.transaction>;
    let rw = 0;
    vi.spyOn(shared, 'transaction').mockImplementation(((...args: unknown[]) => {
      if (args[1] === 'readwrite') rw++;
      return realTx(...args);
    }) as never);

    await cleanLegacySharedDb();
    await cleanLegacySharedDb();
    expect(rw, 'readwrite по общей базе без изменений').toBe(0);

    await shared.put('versions', { id: 'v_orphan2', documentId: 'gone2', guestId: 'u_old', version: 1, content: 'x' } as never);
    rw = 0;
    await cleanLegacySharedDb();
    expect(rw, 'состав изменился — проход').toBeGreaterThan(0);
    expect(await shared.get('versions', 'v_orphan2')).toBeUndefined();
  });
});
