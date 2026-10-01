import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as cryptoHelpers from '../../crypto/cryptoHelpers';
import * as encryptModule from '../../crypto/encrypt';
import { SupabaseDataProvider } from '../supabaseDataProvider';

// In-memory table for Supabase
const mockTable: Array<Record<string, any>> = [];

vi.mock('../../supabase/client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table !== 'documents') throw new Error(`Unexpected table: ${table}`);

      let pendingUpdate: Record<string, any> | null = null;

      const createQueryBuilder = () => {
        let filters: Array<(r: Record<string, any>) => boolean> = [];

        const builder: any = {
          select: (_cols?: string) => builder,
          is: (col: string, val: any) => {
            filters.push(r => (val === null ? r[col] == null : r[col] === val));
            return builder;
          },
          eq: (col: string, val: any) => {
            filters.push(r => r[col] === val);
            return builder;
          },
          order: () => builder,
          range: (from: number, to: number) => {
            const matches = mockTable.filter(r => filters.every(f => f(r)));
            return Promise.resolve({ data: matches.slice(from, to + 1), error: null });
          },
          maybeSingle: () => {
            const matches = mockTable.filter(r => filters.every(f => f(r)));
            return Promise.resolve({ data: matches[0] ? { ...matches[0] } : null, error: null });
          },
          update: (patch: Record<string, any>) => {
            pendingUpdate = { ...patch };
            return builder;
          },
          then: (resolve: (res: any) => void) => {
            const matches = mockTable.filter(r => filters.every(f => f(r)));
            if (pendingUpdate) {
              for (const row of matches) {
                Object.assign(row, pendingUpdate);
              }
            }
            resolve({ data: matches.map(r => ({ ...r })), error: null });
          },
        };
        return builder;
      };

      return createQueryBuilder();
    },
  }),
}));

describe('S-21: tag writers go through writeDocumentPatch (R6Q-032 hardening)', () => {
  const userId = 'u_r6q032_test';

  beforeEach(async () => {
    vi.clearAllMocks();
    mockTable.length = 0;

    cryptoHelpers.setProfileLoaded(userId, true);
    cryptoHelpers.setEncryptionEnabled(userId, true);

    const rawKey = new Uint8Array(32);
    crypto.getRandomValues(rawKey);
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    vi.spyOn(encryptModule, 'getSessionKey').mockReturnValue(key);
  });

  it('renameTagInAllDocs: with N1-1 guard mutated off, no row ends up _encrypted:true with plaintext title', async () => {
    // Seed an unencrypted document (created before vault) with plaintext title and tag
    mockTable.push({
      uuid: 'doc-plaintext-1',
      user_id: userId,
      title: 'Plaintext Title',
      mood: 'Plaintext Mood',
      tags: ['old-tag'],
      _encrypted: false,
      deleted_at: null,
    });

    // Mutate N1-1 guard off: maybeDecrypt tolerates unencrypted tags under vault
    vi.spyOn(cryptoHelpers, 'maybeDecrypt').mockImplementation(async (doc: any) => ({
      ...doc,
      tags: doc.tags,
    }));

    await SupabaseDataProvider.renameTagInAllDocs(userId, 'old-tag', 'new-tag');

    const row = mockTable.find(r => r.uuid === 'doc-plaintext-1')!;
    expect(row).toBeDefined();

    // If _encrypted is true, title MUST NOT be plaintext!
    if (row._encrypted === true) {
      expect(row.title).not.toBe('Plaintext Title');
    }
  });

  it('removeTagFromAllDocs: with N1-1 guard mutated off, no row ends up _encrypted:true with plaintext title', async () => {
    mockTable.push({
      uuid: 'doc-plaintext-2',
      user_id: userId,
      title: 'Plaintext Title 2',
      mood: 'Plaintext Mood 2',
      tags: ['delete-tag'],
      _encrypted: false,
      deleted_at: null,
    });

    vi.spyOn(cryptoHelpers, 'maybeDecrypt').mockImplementation(async (doc: any) => ({
      ...doc,
      tags: doc.tags,
    }));

    await SupabaseDataProvider.removeTagFromAllDocs(userId, 'delete-tag');

    const row = mockTable.find(r => r.uuid === 'doc-plaintext-2')!;
    expect(row).toBeDefined();

    if (row._encrypted === true) {
      expect(row.title).not.toBe('Plaintext Title 2');
    }
  });
});
