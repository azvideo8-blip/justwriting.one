// DA-4 (дейлик 27.11, подозрение 2): ссылки на заметку приходят то локальным id, то
// постоянным uuid, то linkedCloudId. Проверка видимости знала только первый — видимая
// заметка по uuid считалась скрытой (панель выключена, тема не предложена).
// Мутация: в findNoteRow не искать по uuid/linkedCloudId — красный.
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { findNoteRow, noteHiddenFromAI } from '../isExcludedFromAI';

const doc = (id: string, over: object = {}) => ({
  id, guestId: 'u-da4', title: id, currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1,
  firstSessionAt: 1, lastSessionAt: 1, tags: [], ...over,
});

beforeEach(async () => {
  const db = await getLocalDb();
  await db.clear('documents');
  await db.put('documents', doc('local-1', { uuid: 'uuid-1' }) as never);
  await db.put('documents', doc('local-2', { linkedCloudId: 'cloud-2' }) as never);
  await db.put('documents', doc('local-3', { uuid: 'uuid-3', excludedFromAI: true }) as never);
});

describe('DA-4: заметка находится по любому своему номеру', () => {
  it.each([['local-1'], ['uuid-1'], ['cloud-2']])('видимая по %s — не скрыта', async id => {
    expect(await noteHiddenFromAI(id)).toBe(false);
  });

  it('скрытая по uuid — скрыта', async () => {
    expect(await noteHiddenFromAI('uuid-3')).toBe(true);
  });

  it('номер ни к чему не ведёт — скрыта, как и прежде', async () => {
    expect(await noteHiddenFromAI('nobody')).toBe(true);
  });

  // Ревью DA-4: uuid уникален (индекс), а linkedCloudId — нет; две строки — скрыта, если скрыта любая.
  // Мутация: брать первую строку — красный.
  it('две строки с одним linkedCloudId, одна скрыта — скрыта', async () => {
    const db = await getLocalDb();
    await db.put('documents', doc('local-4a', { linkedCloudId: 'cloud-4' }) as never);
    await db.put('documents', doc('local-4b', { linkedCloudId: 'cloud-4', excludedFromAI: true }) as never);
    expect(await noteHiddenFromAI('cloud-4')).toBe(true);
  });

  it('строка по uuid — с локальным id (свод лежит под ним)', async () => {
    expect((await findNoteRow('uuid-1'))?.id).toBe('local-1');
  });
});
