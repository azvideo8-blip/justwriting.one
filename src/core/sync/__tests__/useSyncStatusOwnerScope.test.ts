import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';

const USER = 'user_a6_owner';
const OTHER = 'user_a6_other';

// getLocalDb() без аргумента берёт владельца из сессии — как в настоящем
// приложении. Без этой моки тест читал бы другую базу и краснел бы не по той
// причине.
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));

const { useSyncStatus } = await import('../useSyncStatus');
const { getLocalDb } = await import('../../storage/localDb');
// BS (N-2): pollSyncStatus берёт движок синка динамическим импортом. Первый замер
// в файле платил ~2,5 с за загрузку графа модулей и не успевал в waitFor — тест
// про владельца очереди, а не про скорость куска. Прогрев до тестов.
await import('../../services/SyncService');
await import('../../services/LocalStoreSyncService');

// R2-028: соседи по тому же Promise.all в pollSyncStatus передают userId, а
// getPendingCount — нет. В базе одного пользователя лежат задачи, приехавшие из
// общей легаси-базы и от переключения аккаунта; без фильтра по владельцу они
// попадали в бейдж текущего. Красен без аргумента: 3 вместо 2.
describe('A-6 (R2-028): the queue badge counts this account, not this browser', () => {
  beforeEach(async () => {
    localStorage.clear();
    const db = await getLocalDb(USER);
    for (const r of await db.getAll('syncQueue')) await db.delete('syncQueue', (r as { id: string }).id);
    await db.put('syncQueue', { id: 'sync_mine', documentId: 'doc_mine', createdAt: 1, ownerId: USER } as never);
    await db.put('syncQueue', { id: 'sync_theirs', documentId: 'doc_theirs', createdAt: 1, ownerId: OTHER } as never);
    // Задача старше поля владельца: она ничья и считается этой — иначе счётчик
    // потерял бы долг.
    await db.put('syncQueue', { id: 'sync_legacy', documentId: 'doc_legacy', createdAt: 1 } as never);
    // Строка замка задачей не является ни у кого.
    await db.put('syncQueue', { id: 'lock_cloud_mine', documentId: 'doc_mine', createdAt: 1, ownerId: USER } as never);
  });

  it('показывает только задачи своего владельца', async () => {
    const { result } = renderHook(() => useSyncStatus(USER));
    await waitFor(() => expect(result.current.pendingCount).toBe(2));
  });
});

// R3-011: журнал удалений ИИ-сторов не читается — загрузки ИИ стоят. Флаг
// unknown у сводки был, но бейдж его не читал и показывал «синхронизировано».
describe('R3-011: unreadable AI-store delete journal is not «synced»', () => {
  it('битый журнал удалений ИИ даёт hasUnknown', async () => {
    const db = await getLocalDb(USER);
    for (const r of await db.getAll('syncQueue')) await db.delete('syncQueue', (r as { id: string }).id);
    localStorage.setItem('ai_sync_pending_deletes', '{not json');
    const { result } = renderHook(() => useSyncStatus(USER));
    await waitFor(() => expect(result.current.hasUnknown).toBe(true));
  });
});

// R3-024: снимок счётчиков общий для всех экземпляров хука. После смены учётки
// хук копировал в себя снимок прежней, пока не приходил ответ по новой.
describe('R3-024: account switch never shows the previous account counts', () => {
  it('ни один рендер новой учётки не видит счётчики старой', async () => {
    const db = await getLocalDb(USER);
    for (const r of await db.getAll('syncQueue')) await db.delete('syncQueue', (r as { id: string }).id);
    await db.put('syncQueue', { id: 'sync_a', documentId: 'doc_a', createdAt: 1, ownerId: USER } as never);
    await db.put('syncQueue', { id: 'sync_b', documentId: 'doc_b', createdAt: 1, ownerId: USER } as never);
    localStorage.removeItem('ai_sync_pending_deletes');

    const seen: Array<{ uid: string; pending: number }> = [];
    const { result, rerender } = renderHook(({ uid }) => {
      const s = useSyncStatus(uid);
      seen.push({ uid, pending: s.pendingCount });
      return s;
    }, { initialProps: { uid: USER } });
    await waitFor(() => expect(result.current.pendingCount).toBe(2));

    rerender({ uid: OTHER });
    await new Promise(r => setTimeout(r, 300));
    expect(seen.filter(x => x.uid === OTHER).map(x => x.pending)).not.toContain(2);
  });
});
