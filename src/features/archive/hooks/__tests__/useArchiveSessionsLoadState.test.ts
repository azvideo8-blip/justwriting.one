// 0.11.22: чтение архива отдаёт LoadState.
// Мутации (прогнаны, каждая красит свой тест):
//  Х1 — начальное состояние { status: 'done', cloudFailed: false }     → «до первого чтения — не „пусто“»;
//  Х2 — в listState у loading убрать stale                             → «перечитывание держит список»;
//  Х3 — в catch не ставить error (оставить loading)                    → «сбой назван, с повтором»;
//  Х4 — restore: всегда 'archive_trash_restored', 'success'            → «облако не ответило — предупреждение».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useArchiveSessions } from '../useArchiveSessions';
import type { ArchiveSession } from '../../types';

const showToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: vi.fn((selector: (s: { isVaultUnlocked: boolean }) => unknown) => selector({ isVaultUnlocked: false })),
}));
vi.mock('../useArchiveWordCloud', () => ({ rebuildWordCloud: vi.fn().mockResolvedValue(undefined) }));

const loadAllSessions = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/services/UnifiedSessionLoader', () => ({ loadAllSessions, loadSessionContent: vi.fn() }));
const restoreArchiveSession = vi.hoisted(() => vi.fn());
vi.mock('../../services/archiveCrud', async (orig) => ({
  ...(await orig<typeof import('../../services/archiveCrud')>()),
  restoreArchiveSession,
  pruneExpiredTrash: vi.fn(async (sessions: ArchiveSession[]) => ({ prunedCount: 0, remainingSessions: sessions })),
}));

const note = (id: string, extra: Partial<ArchiveSession> = {}): ArchiveSession => ({
  id, userId: 'u_ls', content: 'синтетика', duration: 1, wordCount: 1, charCount: 9, wpm: 1,
  title: id, tags: [], createdAt: new Date('2026-11-19T10:00:00Z'), _isLocal: true, ...extra,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('useArchiveSessions: состояние чтения', () => {
  beforeEach(() => vi.clearAllMocks());

  it('до первого чтения — «читаем», а не «пусто» (и на самом первом кадре, до эффекта)', () => {
    loadAllSessions.mockReturnValue(new Promise(() => {}));
    const seen: string[] = [];
    renderHook(() => {
      const r = useArchiveSessions(null, 'u_ls', k => k);
      seen.push(r.listState.status);
      return r;
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(status => status === 'loading'), `кадры: ${seen.join(', ')}`).toBe(true);
  });

  it('перечитывание держит прошлый список, а не скелет', async () => {
    loadAllSessions.mockResolvedValueOnce({ sessions: [note('a')], cloudLoadFailed: false });
    const { result } = renderHook(() => useArchiveSessions(null, 'u_ls', k => k));
    await waitFor(() => expect(result.current.listState.status).toBe('data'));
    const next = deferred<{ sessions: ArchiveSession[]; cloudLoadFailed: boolean }>();
    loadAllSessions.mockReturnValueOnce(next.promise);
    act(() => { void result.current.fetchSessions(); });
    expect(result.current.listState).toMatchObject({ status: 'loading', stale: [{ id: 'a' }] });
    await act(async () => { next.resolve({ sessions: [note('a')], cloudLoadFailed: false }); await next.promise; });
    expect(result.current.listState.status).toBe('data');
  });

  it('не прочиталось — ошибка с повтором, прошлый список остаётся', async () => {
    loadAllSessions.mockResolvedValueOnce({ sessions: [note('a')], cloudLoadFailed: false });
    const { result } = renderHook(() => useArchiveSessions(null, 'u_ls', k => k));
    await waitFor(() => expect(result.current.listState.status).toBe('data'));
    loadAllSessions.mockRejectedValueOnce(new Error('idb'));
    await act(async () => { await result.current.fetchSessions(); });
    const state = result.current.listState;
    expect(state).toMatchObject({ status: 'error', stale: [{ id: 'a' }] });
    loadAllSessions.mockResolvedValueOnce({ sessions: [], cloudLoadFailed: false });
    await act(async () => { if (state.status === 'error') state.retry(); });
    await waitFor(() => expect(result.current.listState.status).toBe('empty'));
  });

  it('облако не ответило, локально пусто — partial, не empty', async () => {
    loadAllSessions.mockResolvedValueOnce({ sessions: [], cloudLoadFailed: true });
    const { result } = renderHook(() => useArchiveSessions(null, 'u_ls', k => k));
    await waitFor(() => expect(result.current.listState).toMatchObject({ status: 'partial', data: [] }));
  });

  it('возврат из корзины без облака — предупреждение, а не «восстановлено»', async () => {
    loadAllSessions.mockResolvedValue({ sessions: [note('t', { trashedAt: 1 })], cloudLoadFailed: false });
    const { result } = renderHook(() => useArchiveSessions(null, 'u_ls', k => k));
    await waitFor(() => expect(result.current.listState.status).toBe('data'));
    restoreArchiveSession.mockResolvedValueOnce({ cloudSynced: false });
    await act(async () => { await result.current.handleRestoreSession(note('t', { trashedAt: 1 })); });
    expect(showToast).toHaveBeenCalledWith('archive_trash_restored_local_only', 'warning');
    restoreArchiveSession.mockResolvedValueOnce({ cloudSynced: true });
    await act(async () => { await result.current.handleRestoreSession(note('t', { trashedAt: 1 })); });
    expect(showToast).toHaveBeenCalledWith('archive_trash_restored', 'success');
  });
});
