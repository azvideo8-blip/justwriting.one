// Дейлик 25.11, рядом с Н-1: отложенное удаление облачной заметки. Настоящие
// StorageService / DocumentService поверх fake-indexeddb; подменён край облака (DataProvider).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const cloud = vi.hoisted(() => ({ deleteDocument: vi.fn(), updateDocument: vi.fn() }));
vi.mock('../../data', () => ({
  DataProvider: {
    deleteDocument: cloud.deleteDocument,
    updateDocument: cloud.updateDocument,
  },
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { getLocalDb } from '../../storage/localDb';
import { StorageService } from '../StorageService';

const U = 'u_d45';
const CLOUD = 'cloud_d45';

const deleteTasks = async () => (await (await getLocalDb(U)).getAll('syncQueue')).filter(t => t.type === 'delete');

beforeEach(async () => {
  vi.clearAllMocks();
  cloud.deleteDocument.mockRejectedValue(new Error('503'));
  cloud.updateDocument.mockResolvedValue(undefined);
  const db = await getLocalDb(U);
  await db.clear('documents');
  await db.clear('syncQueue');
});

describe('удаление ждёт облака', () => {
  // Мутация: выходить при любой найденной задаче — останется мёртвой, красный.
  it('повторное удаление оживляет задачу из карантина', async () => {
    await StorageService.deleteDocument(U, undefined, CLOUD);
    const db = await getLocalDb(U);
    const [task] = await deleteTasks();
    await db.put('syncQueue', { ...task!, dead: true, attempts: 10 });
    await StorageService.deleteDocument(U, undefined, CLOUD);
    const tasks = await deleteTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ dead: false, attempts: 0 });
  });

  // Мутация: убрать clearCloudRemovalTasks из restoreDocument — задача осталась бы и
  // снесла восстановленную заметку, красный.
  it('восстановление снимает отложенное удаление', async () => {
    await StorageService.deleteDocument(U, undefined, CLOUD);
    const db = await getLocalDb(U);
    const [task] = await deleteTasks();
    await db.put('syncQueue', { ...task!, dead: true, attempts: 10 });
    await StorageService.restoreDocument(U, undefined, CLOUD);
    expect(cloud.updateDocument).toHaveBeenCalledWith(U, CLOUD, { trashedAt: null });
    expect(await deleteTasks()).toEqual([]);
  });
});
