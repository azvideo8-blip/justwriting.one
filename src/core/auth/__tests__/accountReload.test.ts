import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  reloadForAccountChange,
  isAccountReloadPending,
  setAccountReloadTarget,
  _resetAccountReloadForTesting,
} from '../accountReload';
import * as reportErrorModule from '../../../shared/errors/reportError';
import { useWritingKeyboard } from '../../../features/writing/hooks/useWritingKeyboard';
import { useTimerStore } from '../../../features/writing/store/useTimerStore';
import { useSyncStatus } from '../../sync/useSyncStatus';
import { SyncService } from '../../services/SyncService';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

vi.mock('../../services/SyncService', () => ({
  SyncService: {
    getPendingCount: vi.fn(),
    getUnsyncedCount: vi.fn(),
  },
}));

vi.mock('../../../shared/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

describe('R10-2: accountReload insurance and beforeunload veto prevention', () => {
  const origLocation = window.location;
  let reloadMock: ReturnType<typeof vi.fn>;
  let assignMock: ReturnType<typeof vi.fn>;
  let replaceMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetAccountReloadForTesting();
    reloadMock = vi.fn();
    assignMock = vi.fn();
    replaceMock = vi.fn();

    // Mock window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...origLocation,
        href: 'http://localhost:3000/notes',
        reload: reloadMock,
        assign: assignMock,
        replace: replaceMock,
      },
    });
  });

  afterEach(() => {
    _resetAccountReloadForTesting();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: origLocation,
    });
    vi.useRealTimers();
  });

  it('triggers insurance replace() after 3s if page remains alive', async () => {
    vi.useFakeTimers();
    const reportSpy = vi.spyOn(reportErrorModule, 'reportError');

    const promise = reloadForAccountChange();
    await promise;

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();

    // 2.9s: still waiting
    vi.advanceTimersByTime(2900);
    expect(replaceMock).not.toHaveBeenCalled();

    // 3.0s: fallback fires
    vi.advanceTimersByTime(100);
    expect(replaceMock).toHaveBeenCalledWith('http://localhost:3000/notes');
    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Account reload timed out') }),
      expect.objectContaining({ action: 'account_reload_timeout' }),
      'warning'
    );
  });

  it('retries navigation to specified target via replace() after 3s', async () => {
    vi.useFakeTimers();
    setAccountReloadTarget('/login');

    const promise = reloadForAccountChange();
    await promise;

    expect(assignMock).toHaveBeenCalledWith('/login');
    expect(replaceMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('useWritingKeyboard does NOT veto beforeunload when account reload is pending', async () => {
    useTimerStore.setState({ status: 'writing' });
    const dummyRef = { current: null };

    const { unmount } = renderHook(() =>
      useWritingKeyboard({
        sessionStatus: 'writing',
        handlePlayRef: dummyRef,
        handlePauseRef: dummyRef,
        handleFinishRef: dummyRef,
        toggleShortcutsRef: dummyRef,
      })
    );

    // 1. Without account reload pending: handler vetoes unload
    const event1 = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event1, 'returnValue', { writable: true, value: undefined });
    window.dispatchEvent(event1);
    expect(event1.defaultPrevented).toBe(true);
    expect(event1.returnValue).toBe('');

    // 2. With account reload pending: handler does NOT veto unload
    await reloadForAccountChange();
    expect(isAccountReloadPending()).toBe(true);

    const event2 = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event2, 'returnValue', { writable: true, value: undefined });
    window.dispatchEvent(event2);
    expect(event2.defaultPrevented).toBe(false);
    expect(event2.returnValue).toBeUndefined();

    unmount();
  });

  it('useSyncStatus does NOT veto beforeunload when account reload is pending', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('u1'), 'true');
    vi.mocked(SyncService.getPendingCount).mockResolvedValue(3);
    vi.mocked(SyncService.getUnsyncedCount).mockResolvedValue(0);

    const { result, unmount } = renderHook(() => useSyncStatus('u1'));

    await waitFor(() => {
      expect(result.current.pendingCount).toBe(3);
    });

    // 1. Without account reload pending: handler vetoes unload
    const event1 = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event1, 'returnValue', { writable: true, value: undefined });
    window.dispatchEvent(event1);
    expect(event1.defaultPrevented).toBe(true);
    expect(event1.returnValue).toBe('');

    // 2. With account reload pending: handler does NOT veto unload
    await reloadForAccountChange();
    expect(isAccountReloadPending()).toBe(true);

    const event2 = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event2, 'returnValue', { writable: true, value: undefined });
    window.dispatchEvent(event2);
    expect(event2.defaultPrevented).toBe(false);
    expect(event2.returnValue).toBeUndefined();

    unmount();
  });

  it('audits all beforeunload listeners in src/ to ensure they either do not veto or check isAccountReloadPending', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const glob = await import('glob');

    const srcDir = path.resolve(__dirname, '../../../');
    const files = glob.sync('**/*.{ts,tsx}', { cwd: srcDir, nodir: true, absolute: true })
      .filter(f => !f.includes('/__tests__/') && !f.includes('/test/'));

    // Non-blind gate: must find at least 50 source files in src/
    expect(files.length).toBeGreaterThan(50);

    const beforeUnloadFiles: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('beforeunload')) {
        beforeUnloadFiles.push(file);
        const hasVeto = content.includes('preventDefault') || content.includes('returnValue');
        if (hasVeto) {
          expect(
            content.includes('isAccountReloadPending'),
            `${path.relative(srcDir, file)} has beforeunload veto (preventDefault/returnValue) but does not check isAccountReloadPending()`
          ).toBe(true);
        }
      }
    }

    // Non-blind gate: must have found all 4 known beforeunload files in src/
    expect(beforeUnloadFiles.length).toBeGreaterThanOrEqual(4);
  });
});
