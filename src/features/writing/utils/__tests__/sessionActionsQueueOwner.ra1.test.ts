// RA1-1: задача синка уходила в гостевую базу, если в памяти вкладки ещё не
// было пользователя (окно восстановления сессии, `authProvider.currentUser`).
// cleanupDraftsAfterSave знает userId, но звал addToQueue без него, а
// addToSyncQueue резолвит базу через getCurrentUser() — при null это
// `justwriting-local`. Заметка лежит в базе аккаунта, задача — в гостевой:
// «локальная копия есть, облачной не будет». Фальсификация: убрать userId из
// вызова addToQueue — тест красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../../../core/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/auth')>();
  return { ...actual, getCurrentUser: () => null };
});

vi.mock('../../services/WritingDraftService', () => ({
  WritingDraftService: {
    deleteDraft: vi.fn().mockResolvedValue({ localOk: true, cloudOk: true }),
    deleteDraftLocal: vi.fn().mockResolvedValue({ localOk: true }),
    deleteDraftCloud: vi.fn().mockResolvedValue({ cloudOk: true }),
    bumpDraftGeneration: vi.fn().mockReturnValue(1),
  },
}));

vi.mock('../../../../core/services/SyncService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/services/SyncService')>();
  return {
    SyncService: {
      ...actual.SyncService,
      // Офлайн-ветка CloudSyncService.addCloudCopy бросает ровно так.
      syncOne: vi.fn().mockRejectedValue(new Error('Not connected to cloud. Changes saved locally.')),
    },
  };
});

import { cleanupDraftsAfterSave } from '../sessionActions';
import { LocalStorageService } from '../../../../core/services/LocalStorageService';
import { getLocalDb } from '../../../../core/storage/localDb';

function noteInput() {
  return {
    title: 'Синтетическая заметка',
    content: 'Черновик без сети',
    wordCount: 3,
    duration: 5,
    wpm: 10,
    tags: [],
    sessionStartedAt: new Date(),
  };
}

describe('RA1-1: задача офлайн-сохранения принадлежит базе аккаунта', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('офлайн-сохранение в окне восстановления сессии ставит задачу в syncQueue аккаунта', async () => {
    const userId = `u_ra11_${Date.now()}`;
    const { localId } = await LocalStorageService.saveNew(userId, noteInput());

    await cleanupDraftsAfterSave(userId, false, localId);

    const db = await getLocalDb(userId);
    const queue = await db.getAll('syncQueue');
    const tasks = queue.filter(t => t.documentId === localId && !t.id.startsWith('lock_cloud_'));
    expect(tasks, 'задача должна лежать в базе аккаунта, а не в гостевой').toHaveLength(1);
  });
});
