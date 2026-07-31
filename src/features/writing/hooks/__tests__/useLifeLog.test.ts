import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLifeLog } from '../useLifeLog';

const mocks = vi.hoisted(() => ({
  getUserDocuments: vi.fn(),
  getGuestDocuments: vi.fn(),
}));

vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: { getUserDocuments: mocks.getUserDocuments },
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { getGuestDocuments: mocks.getGuestDocuments },
}));

const stableT = (key: string) => key;
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: stableT, language: 'ru', setLanguage: () => {}, tp: (key: string) => key }),
}));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

// A cloud read that failed and a cloud that is genuinely empty produce the same
// empty list. Telling them apart is the whole point: the Life Log built from
// local notes alone shows days the owner did write as days they did not.
describe('useLifeLog — unknown is not empty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGuestDocuments.mockResolvedValue([]);
  });

  it('reports the cloud as unknown when the read fails', async () => {
    mocks.getUserDocuments.mockRejectedValue(new Error('unavailable'));

    const { result } = renderHook(() => useLifeLog('user_1', false));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cloudUnknown).toBe(true);
  });

  it('does not report unknown when the cloud is genuinely empty', async () => {
    mocks.getUserDocuments.mockResolvedValue([]);

    const { result } = renderHook(() => useLifeLog('user_1', false));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cloudUnknown).toBe(false);
    expect(result.current.unifiedDocuments).toEqual([]);
  });
});
