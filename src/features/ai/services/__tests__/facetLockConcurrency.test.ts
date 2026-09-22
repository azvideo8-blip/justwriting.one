import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withFacetLock } from '../../../../core/services/facetLock';
import { restoreAIDataFromCloud } from '../AIRestoreService';
import { DataProvider } from '../../../../core/data';
import { getLocalDb } from '../../../../core/storage/localDb';

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getUserSummaries: vi.fn().mockResolvedValue([]),
    getUserEmbeddingsPaginated: vi.fn().mockResolvedValue({ items: [], readCount: 0 }),
    getLocalStoreRecords: vi.fn().mockResolvedValue([]),
    getProfile: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: vi.fn().mockReturnValue(false),
  maybeDecrypt: vi.fn().mockImplementation(async (d: unknown) => d),
}));

vi.mock('../../../../core/crypto/encrypt', () => ({
  getSessionKey: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(),
}));

describe('CHOKE-3: withFacetLock serialization with AIRestoreService and clear', () => {
  let mockDb: any;
  let putCalls: Array<{ store: string; value: any }>;
  let clearCalls: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    putCalls = [];
    clearCalls = [];

    mockDb = {
      objectStoreNames: {
        contains: (s: string) => s === 'aiProfileFacets',
      },
      get: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue([]),
      getAllKeys: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockImplementation(async (store: string, value: any) => {
        putCalls.push({ store, value });
      }),
      clear: vi.fn().mockImplementation(async (store: string) => {
        clearCalls.push(store);
      }),
    };

    vi.mocked(getLocalDb).mockResolvedValue(mockDb);
  });

  it('AIRestoreService serializes aiProfileFacets put behind existing withFacetLock', async () => {
    let releaseLock!: () => void;
    const lockDeferred = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const executionOrder: string[] = [];

    // 1. Acquire facet lock with an in-flight operation (e.g. AIProfileFacetBuilder)
    const inFlightOp = withFacetLock(async () => {
      executionOrder.push('in_flight_start');
      await lockDeferred;
      executionOrder.push('in_flight_end');
    });

    // 2. Prepare cloud local_store_records with an aiProfileFacets record
    vi.mocked(DataProvider.getLocalStoreRecords).mockResolvedValue([
      {
        store: 'aiProfileFacets',
        key: 'facet_1',
        payload: {
          data: JSON.stringify({ id: 'facet_1', label: 'Coding', updatedAt: 12345 }),
          updatedAt: 12345,
        },
      } as any,
    ]);

    // 3. Start restoreAIDataFromCloud concurrently
    const restorePromise = restoreAIDataFromCloud('user_1');

    // Give microtasks a chance to tick
    await new Promise((r) => setTimeout(r, 10));

    // The in-flight operation should have started, but not finished
    expect(executionOrder).toEqual(['in_flight_start']);
    // The database put for aiProfileFacets must NOT have happened yet because it's waiting on withFacetLock!
    expect(putCalls.length).toBe(0);

    // 4. Release the in-flight operation
    releaseLock();
    await inFlightOp;
    await restorePromise;

    // Both should now be finished in sequential order
    expect(executionOrder).toEqual(['in_flight_start', 'in_flight_end']);
    expect(putCalls).toEqual([
      {
        store: 'aiProfileFacets',
        value: { id: 'facet_1', label: 'Coding', updatedAt: 12345 },
      },
    ]);
  });

  it('clear logic withFacetLock blocks until in-flight operation completes', async () => {
    let releaseLock!: () => void;
    const lockDeferred = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const executionOrder: string[] = [];

    const inFlightOp = withFacetLock(async () => {
      executionOrder.push('in_flight_start');
      await lockDeferred;
      executionOrder.push('in_flight_end');
    });

    const clearPromise = withFacetLock(() => mockDb.clear('aiProfileFacets'));

    await new Promise((r) => setTimeout(r, 10));
    expect(clearCalls).toEqual([]);

    releaseLock();
    await inFlightOp;
    await clearPromise;

    expect(clearCalls).toEqual(['aiProfileFacets']);
  });

  it('writeFacetStore serializes writes behind existing lock and provides writer methods', async () => {
    const { writeFacetStore } = await import('../../../../core/services/facetLock');

    let releaseLock!: () => void;
    const lockDeferred = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const executionOrder: string[] = [];

    const inFlightOp = withFacetLock(async () => {
      executionOrder.push('in_flight_start');
      await lockDeferred;
      executionOrder.push('in_flight_end');
    });

    const writePromise = writeFacetStore(async (store) => {
      executionOrder.push('write_start');
      await store.put({ id: 'facet_new', label: 'Art', noteIds: [] } as any);
      await store.clear();
      executionOrder.push('write_end');
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(putCalls.length).toBe(0);
    expect(clearCalls.length).toBe(0);

    releaseLock();
    await inFlightOp;
    await writePromise;

    expect(executionOrder).toEqual(['in_flight_start', 'in_flight_end', 'write_start', 'write_end']);
    expect(putCalls).toEqual([{ store: 'aiProfileFacets', value: { id: 'facet_new', label: 'Art', noteIds: [] } }]);
    expect(clearCalls).toEqual(['aiProfileFacets']);
  });

  it('NARROW-2 guard: no raw db.put or db.clear on aiProfileFacets outside facetLock.ts', async () => {
    const { execSync } = await import('node:child_process');
    const rootDir = process.cwd();

    let output = '';
    try {
      output = execSync('git grep -E "db\\.(put|clear)\\([^)]*aiProfileFacets" src/', {
        cwd: rootDir,
        encoding: 'utf8',
      }).trim();
    } catch (e: any) {
      output = e.stdout?.toString()?.trim() ?? '';
    }

    const lines = output ? output.split('\n') : [];
    // Only src/core/services/facetLock.ts is permitted to contain these direct calls
    const violations = lines.filter(line => 
      !line.startsWith('src/core/services/facetLock.ts:') &&
      !line.includes('facetLockConcurrency.test.ts')
    );
    expect(violations).toEqual([]);
  });
});

