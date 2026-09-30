// K-6/N-94: dropQueueTasksFor глотал ошибку чтения очереди без следа —
// застрявшая задача становилась невидимой. Падение остаётся не фатальным,
// но теперь уходит в reportError('warning'), и вызывающий доводит свою работу.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

// Прокси поверх настоящей fake-indexeddb базы: только хранилище syncQueue
// кидает при открытии транзакции, остальная база работает как обычно.
vi.mock('../../storage/localDb', async importOriginal => {
  const actual = await importOriginal<typeof import('../../storage/localDb')>();
  return {
    ...actual,
    getLocalDb: vi.fn(async (...args: unknown[]) => {
      const db = await (actual.getLocalDb as any)(...args);
      return new Proxy(db, {
        get(target, prop) {
          if (prop === 'transaction') {
            return (stores: string | string[], mode?: string) => {
              const names = Array.isArray(stores) ? stores : [stores];
              const tx = target.transaction(stores, mode);
              if (names.includes('syncQueue')) {
                // Ломаем только чтение списка задач: хендлер замка ходит
                // через get/put и должен продолжать работать.
                (tx.store as { getAll: unknown }).getAll = () =>
                  Promise.reject(new Error('syncQueue store is broken'));
              }
              return tx;
            };
          }
          const value = (target as Record<PropertyKey, unknown>)[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }),
  };
});

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: 'u_drop_queue' }),
  getCurrentUserId: () => 'u_drop_queue',
}));

vi.mock('../DocumentService', () => ({
  DocumentService: {
    getDocument: vi.fn().mockResolvedValue(null),
    getDocumentWithDeleted: vi.fn().mockResolvedValue(null),
    createDocument: vi.fn().mockResolvedValue('cloud_new_uuid'),
    updateDocumentAfterSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../VersionService', () => ({
  VersionService: {
    getVersions: vi.fn().mockResolvedValue([]),
    addVersion: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreDelete: vi.fn(), scheduleStoreSync: vi.fn() },
}));

import { reportError } from '../../../shared/errors/reportError';
import { CloudSyncService, CLOUD_COPY_LOCAL_ONLY } from '../CloudSyncService';
import { getLocalDb } from '../../storage/localDb';
import { setProfileLoaded, setEncryptionEnabled } from '../../crypto/cryptoHelpers';

describe('K-6/N-94: падение syncQueue в dropQueueTasksFor видно и не фатально', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setProfileLoaded('u_drop_queue', true);
    setEncryptionEnabled('u_drop_queue', false);
    const db = await getLocalDb('u_drop_queue');
    await db.clear('documents');
    await db.clear('versions');
  });

  it('addCloudCopy доводит localOnly-путь до конца, а отказ очереди уходит в reportError', async () => {
    await getLocalDb('u_drop_queue').then(db => db.put('documents', {
      id: 'local_dq_1',
      uuid: 'uuid_dq_1',
      guestId: 'u_drop_queue',
      title: 'Локальная заметка',
      currentVersion: 1,
      totalWords: 3,
      totalDuration: 1,
      sessionsCount: 1,
      tags: [],
      linkedCloudId: '',
      localOnly: true,
    } as never));

    const result = await CloudSyncService.addCloudCopy('u_drop_queue', 'local_dq_1');

    expect(result).toBe(CLOUD_COPY_LOCAL_ONLY);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'syncQueue store is broken' }),
      expect.objectContaining({ action: 'dropQueueTasksFor' }),
      'warning',
    );
  });
});
