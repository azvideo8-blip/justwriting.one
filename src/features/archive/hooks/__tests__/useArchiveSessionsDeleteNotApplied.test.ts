import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useArchiveSessions } from '../useArchiveSessions';
import { ArchiveSession } from '../../types';
import type { AppUser } from '../../../../core/auth/types';

const mockShowToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const mockSession: ArchiveSession = {
  id: 's_test_1',
  userId: 'u_f1_test',
  content: 'Hello world',
  duration: 60,
  wordCount: 10,
  charCount: 50,
  wpm: 10,
  title: 'Test Note',
  tags: [],
  createdAt: new Date(),
  _isLegacy: false,
  _isLocal: true,
};

vi.mock('../../../../core/services/UnifiedSessionLoader', () => ({
  loadAllSessions: vi.fn(async () => ({
    sessions: [mockSession],
    cloudLoadFailed: false,
  })),
  loadSessionContent: vi.fn(),
}));

vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: vi.fn((selector) => selector({ isVaultUnlocked: false })),
}));

vi.mock('../../services/archiveCrud', async (orig) => {
  const actual = await orig<typeof import('../../services/archiveCrud')>();
  return {
    ...actual,
    deleteArchiveSession: vi.fn(),
    trashArchiveSession: vi.fn(),
    pruneExpiredTrash: vi.fn(async (sessions) => ({ prunedCount: 0, remainingSessions: sessions })),
  };
});

vi.mock('../useArchiveWordCloud', () => ({
  rebuildWordCloud: vi.fn().mockResolvedValue(undefined),
}));

import { deleteArchiveSession, trashArchiveSession } from '../../services/archiveCrud';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { StorageService } from '../../../../core/services/StorageService';

describe('useArchiveSessions — delete not applied (F-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the note in sessions and shows delete_not_applied_uploading toast when delete is not applied', async () => {
    vi.mocked(deleteArchiveSession).mockResolvedValueOnce({
      cloudSynced: false,
      derivativesOk: false,
      applied: false,
    });

    const mockUser = { uid: 'u_f1_test' } as unknown as AppUser;
    const t = (k: string) => k;
    const { result } = renderHook(() => useArchiveSessions(mockUser, 'u_f1_test', t));

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
    });

    await act(async () => {
      await result.current.handlePermanentDeleteSession(mockSession);
    });

    expect(result.current.sessions).toContainEqual(expect.objectContaining({ id: 's_test_1' }));
    expect(mockShowToast).toHaveBeenCalledWith('delete_not_applied_uploading', 'warning');
  });

  // Доделки 19.11: «удалено только здесь» — предупреждение, а не зелёный успех.
  // Мутация: убрать 'warning' у любого из двух тостов — красный.
  it('отказ облака: удаление и корзина говорят «только на этом устройстве» предупреждением', async () => {
    vi.mocked(deleteArchiveSession).mockResolvedValueOnce({ cloudSynced: false, derivativesOk: true, applied: true });
    vi.mocked(trashArchiveSession).mockResolvedValueOnce({ cloudSynced: false });
    const mockUser = { uid: 'u_f1_test' } as unknown as AppUser;
    const t = (k: string) => k; // вне renderHook: новая функция на каждый рендер зациклит чтение
    const { result } = renderHook(() => useArchiveSessions(mockUser, 'u_f1_test', t));
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => { await result.current.handleTrashSession(mockSession); });
    expect(mockShowToast.mock.calls).toEqual([['delete_local_only_queued', 'warning']]);

    mockShowToast.mockClear();
    await act(async () => { await result.current.handlePermanentDeleteSession(mockSession); });
    expect(mockShowToast.mock.calls).toEqual([['delete_local_only_queued', 'warning']]);
  });

  // Дейлик 25.11 (Н-1). Мутация: убрать ветку cloudPending — зелёный «Корзина очищена», красный.
  it('отказ облака: «Очистить корзину» говорит то же, что удаление по одной', async () => {
    const spy = vi.spyOn(StorageService, 'deleteDocument');
    const mockUser = { uid: 'u_f1_test' } as unknown as AppUser;
    const t = (k: string) => k;
    const { result } = renderHook(() => useArchiveSessions(mockUser, 'u_f1_test', t));
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    spy.mockResolvedValueOnce({ cloudSynced: false, derivativesOk: true, applied: true });
    // DA-6: чистка перечитывает строку — она всё ещё в корзине.
    vi.spyOn(LocalDocumentService, 'getDocument').mockResolvedValue({ id: mockSession.id, trashedAt: 1 } as never);
    await act(async () => { await result.current.handleEmptyTrash([mockSession]); });
    expect(mockShowToast.mock.calls).toEqual([['delete_local_only_queued', 'warning']]);
    expect(result.current.sessions).toEqual([]);

    mockShowToast.mockClear();
    spy.mockResolvedValueOnce({ cloudSynced: true, derivativesOk: true, applied: true });
    await act(async () => { await result.current.handleEmptyTrash([mockSession]); });
    expect(mockShowToast.mock.calls).toEqual([['archive_trash_cleared', 'success']]);
  });
});
