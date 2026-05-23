import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDocuments } from '../useDocuments';

// Use vi.hoisted to declare mocked functions so they are initialized before imports/hoisted mocks
const mocks = vi.hoisted(() => ({
  mockGetUserDocuments: vi.fn(),
  mockGetGuestDocuments: vi.fn(),
}));

vi.mock('../../services/DocumentService', () => ({
  DocumentService: {
    getUserDocuments: mocks.mockGetUserDocuments,
  },
}));

vi.mock('../../services/LocalDocumentService', () => ({
  LocalDocumentService: {
    getGuestDocuments: mocks.mockGetGuestDocuments,
  },
}));

// Return a stable translation function to prevent infinite re-renders
const stableT = (key: string) => key;
vi.mock('../../../../core/i18n', () => ({
  useLanguage: () => ({
    t: stableT,
    language: 'ru',
    setLanguage: () => {},
    tp: (key: string) => key,
  }),
}));

vi.mock('../../../../core/errors/reportError', () => ({
  reportError: vi.fn(),
}));

describe('useDocuments', () => {
  const mockCloudDocs = [
    {
      id: 'doc_cloud_1',
      title: 'Cloud Doc 1',
      currentVersion: 1,
      totalWords: 100,
      totalDuration: 60,
      sessionsCount: 1,
      firstSessionAt: 10000,
      lastSessionAt: 20000,
      tags: [],
    },
    {
      id: 'doc_cloud_2',
      title: 'Cloud Doc 2',
      currentVersion: 2,
      totalWords: 200,
      totalDuration: 120,
      sessionsCount: 2,
      firstSessionAt: 10000,
      lastSessionAt: 30000,
      tags: [],
    },
  ];

  const mockLocalDocs = [
    {
      id: 'doc_local_1',
      title: 'Local Doc 1',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 30,
      sessionsCount: 1,
      firstSessionAt: 10000,
      lastSessionAt: 15000,
      tags: [],
    },
    // Same ID as cloud doc to test deduplication
    {
      id: 'doc_cloud_1',
      title: 'Cloud Doc 1 (Local version)',
      currentVersion: 2,
      totalWords: 120,
      totalDuration: 80,
      sessionsCount: 2,
      firstSessionAt: 10000,
      lastSessionAt: 25000,
      tags: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initially sets loading to true and error to null', async () => {
    mocks.mockGetGuestDocuments.mockReturnValue(new Promise(() => {})); // pending
    const { result } = renderHook(() => useDocuments('user_123', true));

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.documents).toEqual([]);
  });

  it('fetches only guest documents if isGuest is true', async () => {
    mocks.mockGetGuestDocuments.mockResolvedValue(mockLocalDocs);

    const { result } = renderHook(() => useDocuments('guest_user', true));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.mockGetGuestDocuments).toHaveBeenCalledWith('guest_user');
    expect(mocks.mockGetUserDocuments).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.documents).toHaveLength(2);
    expect(result.current.documents[0].id).toBe('doc_local_1');
    expect(result.current.documents[1].id).toBe('doc_cloud_1');
  });

  it('fetches cloud and local documents and deduplicates them when authenticated', async () => {
    mocks.mockGetUserDocuments.mockResolvedValue(mockCloudDocs);
    mocks.mockGetGuestDocuments.mockResolvedValue(mockLocalDocs);

    const { result } = renderHook(() => useDocuments('auth_user', false));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.mockGetUserDocuments).toHaveBeenCalledWith('auth_user');
    expect(mocks.mockGetGuestDocuments).toHaveBeenCalledWith('auth_user');
    expect(result.current.loading).toBe(false);
    // Should have: doc_local_1, doc_cloud_1 (from local docs, since it overrides cloud doc_cloud_1), and doc_cloud_2
    expect(result.current.documents).toHaveLength(3);
    const ids = result.current.documents.map(d => d.id);
    expect(ids).toContain('doc_local_1');
    expect(ids).toContain('doc_cloud_1');
    expect(ids).toContain('doc_cloud_2');
    
    // doc_cloud_1 should have the local title/version (deduped correctly)
    const docCloud1 = result.current.documents.find(d => d.id === 'doc_cloud_1');
    expect(docCloud1?.title).toBe('Cloud Doc 1 (Local version)');
  });

  it('handles partial fetch errors (cloud fails, local succeeds) by preserving local docs and logging warning', async () => {
    mocks.mockGetUserDocuments.mockRejectedValue(new Error('Cloud disconnected'));
    mocks.mockGetGuestDocuments.mockResolvedValue(mockLocalDocs);

    const { result } = renderHook(() => useDocuments('auth_user', false));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull(); // partial error shouldn't fail the whole fetch
    expect(result.current.documents).toHaveLength(2); // contains only local docs
  });

  it('sets error state if the main fetch block fails', async () => {
    mocks.mockGetGuestDocuments.mockRejectedValue(new Error('Local storage corrupt'));

    const { result } = renderHook(() => useDocuments('guest_user', true));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('archive_load_error');
    expect(result.current.documents).toEqual([]);
  });

  it('refreshes documents when refresh is called', async () => {
    mocks.mockGetGuestDocuments.mockResolvedValueOnce([mockLocalDocs[0]]);
    mocks.mockGetGuestDocuments.mockResolvedValueOnce(mockLocalDocs);

    const { result } = renderHook(() => useDocuments('guest_user', true));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.documents).toHaveLength(1);

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.documents).toHaveLength(2);
  });
});
