import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getUserDocuments, getCloudVersionDiscrepancyCount } from '../providers/documents';
import { getUserSummaries } from '../providers/summaries';
import { getLocalStoreRecords } from '../providers/localStore';
import { getVersions } from '../providers/versions';
import { getSupabase } from '../../supabase/client';

vi.mock('../../supabase/client', () => ({
  getSupabase: vi.fn(),
}));

describe('AG-RESTORE-2: Bulk read methods pagination beyond 1000 rows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getUserDocuments pages through multiple batches of 1000 rows', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      uuid: `doc_${i}`,
      user_id: 'user_1',
      title: `Doc ${i}`,
      current_version: 1,
    }));
    const page2 = Array.from({ length: 250 }, (_, i) => ({
      uuid: `doc_${1000 + i}`,
      user_id: 'user_1',
      title: `Doc ${1000 + i}`,
      current_version: 1,
    }));

    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockIs = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockReturnThis();
    const mockRange = vi.fn()
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: page2, error: null });

    const mockFrom = vi.fn().mockReturnValue({
      select: mockSelect,
      eq: mockEq,
      is: mockIs,
      order: mockOrder,
      range: mockRange,
    });

    vi.mocked(getSupabase).mockReturnValue({
      from: mockFrom,
    } as any);

    const docs = await getUserDocuments('user_1');
    expect(docs).toHaveLength(1250);
    expect(mockRange).toHaveBeenCalledTimes(2);
    expect(mockRange).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mockRange).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it('getUserSummaries pages through multiple batches', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      document_id: `doc_${i}`,
      user_id: 'user_1',
      summary: `Summary ${i}`,
    }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({
      document_id: `doc_${1000 + i}`,
      user_id: 'user_1',
      summary: `Summary ${1000 + i}`,
    }));

    const mockRange = vi.fn()
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: page2, error: null });

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: mockRange,
    });

    vi.mocked(getSupabase).mockReturnValue({ from: mockFrom } as any);

    const summaries = await getUserSummaries('user_1');
    expect(summaries).toHaveLength(1050);
    expect(mockRange).toHaveBeenCalledTimes(2);
  });

  it('getLocalStoreRecords pages through multiple batches', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      user_id: 'user_1',
      store: 'aiDialogues',
      key: `dialogue_${i}`,
      payload: { id: `dialogue_${i}` },
    }));
    const page2 = Array.from({ length: 10 }, (_, i) => ({
      user_id: 'user_1',
      store: 'aiDialogues',
      key: `dialogue_${1000 + i}`,
      payload: { id: `dialogue_${1000 + i}` },
    }));

    const mockRange = vi.fn()
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: page2, error: null });

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: mockRange,
    });

    vi.mocked(getSupabase).mockReturnValue({ from: mockFrom } as any);

    const records = await getLocalStoreRecords('user_1', 'aiDialogues');
    expect(records).toHaveLength(1010);
    expect(mockRange).toHaveBeenCalledTimes(2);
  });

  it('getVersions pages through multiple batches', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      document_uuid: 'doc_1',
      user_id: 'user_1',
      version: i + 1,
      content: `v${i + 1}`,
    }));
    const page2 = Array.from({ length: 5 }, (_, i) => ({
      document_uuid: 'doc_1',
      user_id: 'user_1',
      version: 1000 + i + 1,
      content: `v${1000 + i + 1}`,
    }));

    const mockRange = vi.fn()
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: page2, error: null });

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: mockRange,
    });

    vi.mocked(getSupabase).mockReturnValue({ from: mockFrom } as any);

    const versions = await getVersions('user_1', 'doc_1');
    expect(versions).toHaveLength(1005);
    expect(mockRange).toHaveBeenCalledTimes(2);
  });

  it('DEEP-11: getCloudVersionDiscrepancyCount pages both documents and versions beyond 1000 rows', async () => {
    // 1 document with current_version = 1500
    const docs = [{ uuid: 'doc_big', current_version: 1500 }];

    // 1500 versions for doc_big spread across 2 pages
    const verPage1 = Array.from({ length: 1000 }, () => ({ document_uuid: 'doc_big' }));
    const verPage2 = Array.from({ length: 500 }, () => ({ document_uuid: 'doc_big' }));

    const mockDocRange = vi.fn().mockResolvedValue({ data: docs, error: null });
    const mockVerRange = vi.fn()
      .mockResolvedValueOnce({ data: verPage1, error: null })
      .mockResolvedValueOnce({ data: verPage2, error: null });

    const mockFrom = vi.fn((table: string) => {
      if (table === 'documents') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: mockDocRange,
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: mockVerRange,
      };
    });

    vi.mocked(getSupabase).mockReturnValue({ from: mockFrom } as any);

    const discrepancies = await getCloudVersionDiscrepancyCount('user_1');
    // All 1500 versions counted, matching current_version 1500 -> 0 discrepancies
    expect(discrepancies).toBe(0);
    expect(mockVerRange).toHaveBeenCalledTimes(2);
    expect(mockVerRange).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mockVerRange).toHaveBeenNthCalledWith(2, 1000, 1999);
  });
});
