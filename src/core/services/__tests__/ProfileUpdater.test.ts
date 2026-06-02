import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileUpdater } from '../ProfileUpdater';
import { getLocalDb } from '../../storage/localDb';
import { LocalDocumentService } from '../LocalDocumentService';
import { reportError } from '../../../shared/errors/reportError';

vi.mock('../../storage/localDb', () => ({
  getLocalDb: vi.fn(),
}));

vi.mock('../LocalDocumentService', () => ({
  LocalDocumentService: {
    _updateProfile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

function makeStore(profile: unknown | null) {
  return {
    get: vi.fn().mockResolvedValue(profile),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

function makeTransaction(store: ReturnType<typeof makeStore>) {
  return {
    objectStore: vi.fn(() => store),
    done: Promise.resolve(undefined),
  };
}

describe('ProfileUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates existing profile with new word/duration stats', async () => {
    const profile = {
      guestId: 'guest1',
      totalWords: 100,
      totalDuration: 60,
      sessionsCount: 2,
      lastSessionAt: 1000,
    };
    const store = makeStore(profile);
    const tx = makeTransaction(store);
    vi.mocked(getLocalDb).mockResolvedValue({
      transaction: vi.fn(() => tx),
    } as unknown as Awaited<ReturnType<typeof getLocalDb>>);

    await ProfileUpdater.updateLocalProfile('guest1', 100, 200, 60, 120, 5000);

    expect(store.put).toHaveBeenCalledWith({
      ...profile,
      totalWords: 200,
      totalDuration: 120,
      sessionsCount: 3,
      lastSessionAt: 5000,
    });
  });

  it('calls _updateProfile fallback when profile missing', async () => {
    const store = makeStore(null);
    const tx = makeTransaction(store);
    vi.mocked(getLocalDb).mockResolvedValue({
      transaction: vi.fn(() => tx),
    } as unknown as Awaited<ReturnType<typeof getLocalDb>>);

    await ProfileUpdater.updateLocalProfile('guest1', 0, 50, 0, 60, 5000);
    expect(LocalDocumentService._updateProfile).toHaveBeenCalledWith('guest1');
  });

  it('calls _updateProfile fallback on IDB error and reports both errors', async () => {
    vi.mocked(getLocalDb).mockRejectedValue(new Error('idb broken'));

    await ProfileUpdater.updateLocalProfile('guest1', 0, 10, 0, 10, 1000);

    expect(reportError).toHaveBeenCalledTimes(1);
    const firstCall = vi.mocked(reportError).mock.calls[0]!;
    expect((firstCall[0] as Error).message).toBe('idb broken');
    expect((firstCall[1] as Record<string, unknown>).action).toBe('updateLocalProfile');
    expect(LocalDocumentService._updateProfile).toHaveBeenCalledWith('guest1');
  });

  it('reports fallback error if _updateProfile also fails', async () => {
    vi.mocked(getLocalDb).mockRejectedValue(new Error('idb broken'));
    vi.mocked(LocalDocumentService._updateProfile).mockRejectedValue(new Error('fallback failed'));

    await ProfileUpdater.updateLocalProfile('guest1', 0, 10, 0, 10, 1000);

    expect(reportError).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(reportError).mock.calls;
    const fallbackCall = calls.find(c => (c[1] as Record<string, unknown>).action === 'updateLocalProfile_fallback');
    expect(fallbackCall).toBeDefined();
    expect((fallbackCall![0] as Error).message).toBe('fallback failed');
    expect((fallbackCall![1] as Record<string, unknown>).action).toBe('updateLocalProfile_fallback');
  });
});
