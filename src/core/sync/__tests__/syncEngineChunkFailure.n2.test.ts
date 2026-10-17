// BS (N-2): отказ куска ≠ «нечего синхронизировать».
// Движок синка приходит динамическим импортом (см. useSyncStatus), и у этой
// границы есть новый способ отказать: офлайн, устаревший service-worker, свернутый
// после выкатки хэш. Проверка держит два обещания тикета: сбой обязан выглянуть
// как сбой, а не как «всё синхронизировано», и очередь не должна потерять ни
// одной задачи — следующий проход обязан её увидеть и досчитать.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';

const USER = 'user_n2_chunk';

const engine = vi.hoisted(() => ({ fail: true }));

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));

vi.mock('../../services/SyncService', async () => {
  if (engine.fail) throw new Error('Failed to fetch dynamically imported module: SyncService');
  const actual = await vi.importActual<typeof import('../../services/SyncService')>('../../services/SyncService');
  return { SyncService: actual.SyncService };
});

vi.mock('../../services/LocalStoreSyncService', async () => {
  if (engine.fail) throw new Error('Failed to fetch dynamically imported module: LocalStoreSyncService');
  const actual = await vi.importActual<typeof import('../../services/LocalStoreSyncService')>('../../services/LocalStoreSyncService');
  return { getLocalStoreSyncSummary: actual.getLocalStoreSyncSummary };
});

const { useSyncStatus } = await import('../useSyncStatus');
const { getLocalDb } = await import('../../storage/localDb');

async function seedQueue() {
  const db = await getLocalDb(USER);
  for (const r of await db.getAll('syncQueue')) await db.delete('syncQueue', (r as { id: string }).id);
  await db.put('syncQueue', { id: 'n2_a', documentId: 'doc_n2_a', createdAt: 1, ownerId: USER } as never);
  await db.put('syncQueue', { id: 'n2_b', documentId: 'doc_n2_b', createdAt: 2, ownerId: USER } as never);
}

async function queueSize() {
  const db = await getLocalDb(USER);
  return (await db.getAll('syncQueue')).filter(r => (r as { id: string }).id.startsWith('n2_')).length;
}

describe('BS (N-2): сбой загрузки куска синхронизации', () => {
  beforeEach(async () => {
    localStorage.clear();
    engine.fail = true;
    await seedQueue();
  });

  it('показывает сбой, а не «synced», и очередь остаётся целой', async () => {
    const { result } = renderHook(() => useSyncStatus(USER));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.status).not.toBe('synced');
    expect(result.current.hasUnknown, 'сбой обязан выглядеть как незнание').toBe(true);
    expect(result.current.pendingCount, 'нулей после сбоя притворяться нельзя').toBe(0);
    expect(await queueSize()).toBe(2);
  });

  it('следующая попытка досчитывает ту же очередь', async () => {
    const { result } = renderHook(() => useSyncStatus(USER));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.hasUnknown).toBe(true);

    engine.fail = false;
    window.dispatchEvent(new Event('sync-queue-changed'));
    await waitFor(() => expect(result.current.pendingCount).toBe(2), { timeout: 4_000 });
    expect(result.current.hasUnknown).toBe(false);
    expect(await queueSize()).toBe(2);
  });
});
