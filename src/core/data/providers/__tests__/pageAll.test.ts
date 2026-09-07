import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pageAll, PAGE_SIZE } from '../pageAll';
import { getUserDocuments, getCloudVersionDiscrepancyCount } from '../documents';
import { getVersions, getAllVersionsForUser } from '../versions';
import { getUserEmbeddings } from '../embeddings';
import { getUserSummaries } from '../summaries';
import { getLocalStoreRecords } from '../localStore';
import { getSupabase } from '../../../supabase/client';

vi.mock('../../../supabase/client', () => ({
  getSupabase: vi.fn(),
}));

describe('DUP-5: pageAll PostgREST pagination convergence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('pageAll core behaviour', () => {
    it('fetches 1,500 seeded rows across pages without duplicates or loss', async () => {
      const totalRows = 1500;
      const allData = Array.from({ length: totalRows }, (_, i) => ({ id: i, value: `row_${i}` }));

      const queryCalls: Array<{ from: number; to: number }> = [];
      const queryBuilder = vi.fn(async (from: number, to: number) => {
        queryCalls.push({ from, to });
        const slice = allData.slice(from, to + 1);
        return { data: slice, error: null };
      });

      const results = await pageAll(queryBuilder, PAGE_SIZE);

      expect(results).toHaveLength(totalRows);
      expect(results.map(r => r.id)).toEqual(allData.map(r => r.id));
      expect(new Set(results.map(r => r.id)).size).toBe(totalRows);

      // Page calls check: 0..999, 1000..1999 (returns 500 < 1000, stops immediately)
      expect(queryCalls).toEqual([
        { from: 0, to: 999 },
        { from: 1000, to: 1999 },
      ]);
    });

    it('stops without extra call when result is strictly smaller than pageSize', async () => {
      const calls: Array<{ from: number; to: number }> = [];
      const results = await pageAll(async (from, to) => {
        calls.push({ from, to });
        return { data: [{ id: 'single' }], error: null };
      }, 1000);

      expect(results).toEqual([{ id: 'single' }]);
      expect(calls).toHaveLength(1);
    });

    it('returns empty array when table is empty', async () => {
      const calls: Array<{ from: number; to: number }> = [];
      const results = await pageAll(async (from, to) => {
        calls.push({ from, to });
        return { data: [], error: null };
      }, 1000);

      expect(results).toEqual([]);
      expect(calls).toHaveLength(1);
    });

    it('propagates PostgREST errors immediately', async () => {
      const error = new Error('PGRST100: DB error');
      await expect(
        pageAll(async () => ({ data: null, error }), 1000),
      ).rejects.toThrow('PGRST100: DB error');
    });
  });

  describe('parameterized tests: 1,500 seeded rows across all 7 converted functions', () => {
    type ConvertedFnCase = {
      name: string;
      run: () => Promise<unknown[]>;
      generateRow: (i: number) => Record<string, unknown>;
      extractKey: (item: unknown) => string | number;
    };

    const cases: ConvertedFnCase[] = [
      {
        name: 'getUserDocuments',
        run: () => getUserDocuments('user_test'),
        generateRow: (i) => ({
          uuid: `doc_${i}`,
          user_id: 'user_test',
          title: `Document ${i}`,
          current_version: 1,
        }),
        extractKey: (item) => (item as { id: string }).id,
      },
      {
        name: 'getVersions',
        run: () => getVersions('user_test', 'doc_target'),
        generateRow: (i) => ({
          id: `v_id_${i}`,
          document_uuid: 'doc_target',
          user_id: 'user_test',
          version: i + 1,
          content: `Content ${i}`,
        }),
        extractKey: (item) => (item as { id: string }).id,
      },
      {
        name: 'getAllVersionsForUser',
        run: () => getAllVersionsForUser('user_test'),
        generateRow: (i) => ({
          id: `v_id_${i}`,
          document_uuid: `doc_${i % 10}`,
          user_id: 'user_test',
          version: 1,
          content: `Content ${i}`,
        }),
        extractKey: (item) => (item as { id: string }).id,
      },
      {
        name: 'getUserEmbeddings',
        run: () => getUserEmbeddings('user_test'),
        generateRow: (i) => ({
          document_id: `doc_${i}`,
          user_id: 'user_test',
          model: 'text-embedding-3-small',
          embedding: [0.1, 0.2],
        }),
        extractKey: (item) => (item as { documentId: string }).documentId,
      },
      {
        name: 'getUserSummaries',
        run: () => getUserSummaries('user_test'),
        generateRow: (i) => ({
          document_id: `doc_${i}`,
          user_id: 'user_test',
          summary: `Summary of doc ${i}`,
        }),
        extractKey: (item) => (item as { documentId: string }).documentId,
      },
      {
        name: 'getLocalStoreRecords',
        run: () => getLocalStoreRecords('user_test', 'settings'),
        generateRow: (i) => ({
          store: 'settings',
          key: `key_${i}`,
          user_id: 'user_test',
          payload: { val: i },
        }),
        extractKey: (item) => (item as { key: string }).key,
      },
    ];

    for (const { name, run, generateRow, extractKey } of cases) {
      it(`${name}: 1,500 seeded rows come back complete and without duplicates`, async () => {
        const totalRows = 1500;
        const seeded = Array.from({ length: totalRows }, (_, i) => generateRow(i));

        const mockRange = vi.fn((from: number, to: number) => {
          const slice = seeded.slice(from, to + 1);
          return Promise.resolve({ data: slice, error: null });
        });

        const mockQueryBuilder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: mockRange,
        };

        vi.mocked(getSupabase).mockReturnValue({
          from: vi.fn().mockReturnValue(mockQueryBuilder),
        } as any);

        const items = await run();

        expect(items).toHaveLength(totalRows);
        const keys = items.map(extractKey);
        expect(new Set(keys).size).toBe(totalRows);
        expect(mockRange).toHaveBeenCalledTimes(2);
        expect(mockRange).toHaveBeenNthCalledWith(1, 0, 999);
        expect(mockRange).toHaveBeenNthCalledWith(2, 1000, 1999);
      });
    }

    it('getCloudVersionDiscrepancyCount: 1,500 seeded rows on both docs and versions come back complete', async () => {
      const totalDocs = 1500;
      const seededDocs = Array.from({ length: totalDocs }, (_, i) => ({
        uuid: `doc_${i}`,
        current_version: 1,
      }));
      const seededVersions = Array.from({ length: totalDocs }, (_, i) => ({
        document_uuid: `doc_${i}`,
      }));

      const mockDocRange = vi.fn((from: number, to: number) =>
        Promise.resolve({ data: seededDocs.slice(from, to + 1), error: null }),
      );
      const mockVerRange = vi.fn((from: number, to: number) =>
        Promise.resolve({ data: seededVersions.slice(from, to + 1), error: null }),
      );

      vi.mocked(getSupabase).mockReturnValue({
        from: vi.fn((table: string) => {
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
        }),
      } as any);

      const discrepancies = await getCloudVersionDiscrepancyCount('user_test');
      expect(discrepancies).toBe(0);
      expect(mockDocRange).toHaveBeenCalledTimes(2);
      expect(mockVerRange).toHaveBeenCalledTimes(2);
    });
  });

  describe('architecture ratchet: no manual pagination loops in provider files', () => {
    const providerDir = path.resolve(__dirname, '..');
    const filesToCheck = ['documents.ts', 'versions.ts', 'embeddings.ts', 'summaries.ts', 'localStore.ts'];

    for (const file of filesToCheck) {
      it(`${file} routes bulk pagination through pageAll and has no inline while(true) loops with range`, () => {
        const filePath = path.join(providerDir, file);
        const content = fs.readFileSync(filePath, 'utf8');

        // Must import pageAll
        expect(content).toMatch(/import\s+{[^}]*pageAll[^}]*}\s+from\s+['"]\.\/pageAll['"]/);

        // Must not contain manual while (true) loop with .range
        expect(content).not.toMatch(/while\s*\(\s*true\s*\)[^{]*\{[^}]*\.range\s*\(/s);
      });
    }
  });
});
