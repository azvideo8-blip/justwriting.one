// EX-4 (PIN-1, диагностика): отказ чтения — не «всё синхронизировано» и не «облака нет».
// Хук настоящий поверх fake-indexeddb; моки только края (облако, тост, i18n, auth).
// Мутации: `cloudReadFailed ? 'cloud_unknown' : 'cloud_missing'` → всегда missing;
// убрать `localFailed = true` в чтении очереди — красный.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const { getUserDocuments, showToast } = vi.hoisted(() => ({ getUserDocuments: vi.fn(), showToast: vi.fn() }));

vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ user: null }) }));
vi.mock('../../../../core/services/SyncService', () => ({ SyncService: { syncPending: vi.fn() } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: {
    getUserDocuments,
    getCloudVersionDiscrepancyCount: vi.fn(async () => 0),
  },
}));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../services/AIService', () => ({ AIService: { summarize: vi.fn() } }));

import { useSyncDiagnostics } from '../useSyncDiagnostics';
import { StorageService } from '../../../../core/services/StorageService';
import { getLocalDb, resetDbInstance } from '../../../../core/storage/localDb';

const USER = 'u_diag_ex4';

async function seedLinked() {
  const db = await getLocalDb();
  await db.put('documents', {
    id: 'doc_linked', guestId: USER, title: 'Синтетика', linkedCloudId: 'cloud_gone',
    currentVersion: 1, totalWords: 3,
  } as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetDbInstance();
  localStorage.clear();
  const db = await getLocalDb();
  await db.clear('documents');
  await db.clear('syncQueue');
});
afterEach(() => { vi.restoreAllMocks(); });

describe('EX-4: отказ чтения диагностики назван', () => {
  // Дейлик 24.11 (Н-2). Мутация: не читать skippedVersions — красный.
  it.each([
    [3, 'storage_download_versions_skipped', 'warning'],
    [0, 'Downloaded copy to device', 'success'],
  ])('скачали копию, непрочитанных версий %i → %s', async (skippedVersions, text, kind) => {
    await seedLinked();
    getUserDocuments.mockResolvedValue([]);
    vi.spyOn(StorageService, 'addLocalCopy').mockResolvedValue({ localId: 'doc_c', skippedVersions });
    const { result } = renderHook(() => useSyncDiagnostics({ userId: USER }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.handleDownloadItem({ id: 'x', cloudId: 'c1' } as never); });
    expect(showToast.mock.calls.map(c => [c[0], c[1]])).toEqual([[text, kind]]);
  });

  it('облако не прочитано — копия «не найдена» показана как cloud_unknown, а не cloud_missing', async () => {
    await seedLinked();
    getUserDocuments.mockRejectedValue(new Error('SYNTHETIC_CLOUD_DOWN'));
    const { result } = renderHook(() => useSyncDiagnostics({ userId: USER }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cloudReadFailed).toBe(true);
    expect(result.current.items.find(i => i.id === 'doc_linked')?.status).toBe('cloud_unknown');
  });

  it('контроль: облако прочитано и копии нет — cloud_missing, отказа нет', async () => {
    await seedLinked();
    getUserDocuments.mockResolvedValue([]);
    const { result } = renderHook(() => useSyncDiagnostics({ userId: USER }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cloudReadFailed).toBe(false);
    expect(result.current.items.find(i => i.id === 'doc_linked')?.status).toBe('cloud_missing');
  });

  it('чтение очереди упало — localReadFailed, а не «0 в очереди»', async () => {
    getUserDocuments.mockResolvedValue([]);
    const db = await getLocalDb();
    const orig = db.getAll.bind(db) as (store: string) => Promise<unknown[]>;
    (db as unknown as { getAll: (store: string) => Promise<unknown[]> }).getAll = (store: string) =>
      store === 'syncQueue' ? Promise.reject(new Error('SYNTHETIC_QUEUE_READ')) : orig(store);
    const { result } = renderHook(() => useSyncDiagnostics({ userId: USER }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.localReadFailed).toBe(true);
  });

  it('контроль: локальное чтение прошло — localReadFailed сброшен', async () => {
    getUserDocuments.mockResolvedValue([]);
    const { result } = renderHook(() => useSyncDiagnostics({ userId: USER }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.localReadFailed).toBe(false);
  });
});
