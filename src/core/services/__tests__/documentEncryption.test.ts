import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentService } from '../DocumentService';
import { SupabaseDataProvider } from '../../data/supabaseDataProvider';
import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';
import * as encryptModule from '../../crypto/encrypt';

// In-memory mock for Supabase
const mockDocumentsTable: Array<Record<string, any>> = [];

vi.mock('../../supabase/client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table !== 'documents') throw new Error(`Unexpected table: ${table}`);
      return {
        select: (_cols: string) => {
          let filtered = [...mockDocumentsTable];
          const createFilterObj = () => ({
            eq: (col: string, val: any) => {
              filtered = filtered.filter(row => row[col] === val);
              return createFilterObj();
            },
            is: (col: string, val: any) => {
              filtered = filtered.filter(row => (val === null ? row[col] == null : row[col] === val));
              return createFilterObj();
            },
            order: () => createFilterObj(),
            range: (from: number, to: number) => Promise.resolve({ data: filtered.slice(from, to + 1), error: null }),
            maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
            then: (resolve: any) => resolve({ data: filtered, error: null }),
          });
          return createFilterObj();
        },
        insert: async (payload: any) => {
          mockDocumentsTable.push({ ...payload });
          return { error: null };
        },
        update: (updatePayload: any) => ({
          eq: (col: string, val: any) => ({
            eq: (col2: string, val2: any) => {
              for (const row of mockDocumentsTable) {
                if (row[col] === val && row[col2] === val2) {
                  Object.assign(row, updatePayload);
                }
              }
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
    },
  }),
}));

describe('DocumentService & SupabaseDataProvider — Cloud Title/Tags/Mood Encryption (Ticket 3)', () => {
  const userId = 'user-encrypt-test';

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDocumentsTable.length = 0;
    setProfileLoaded(userId, true);
    setEncryptionEnabled(userId, true);

    // Setup actual WebCrypto session key
    const rawKey = new Uint8Array(32);
    crypto.getRandomValues(rawKey);
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    vi.spyOn(encryptModule, 'getSessionKey').mockReturnValue(key);
  });

  it('encrypts title, mood, and tags upon createDocument and decrypts them upon getDocument', async () => {
    const docId = await DocumentService.createDocument(userId, {
      title: 'Секретная заметка',
      tags: ['личное', 'пароли'],
      mood: 'спокойное',
      uuid: 'doc-uuid-1',
    });

    expect(docId).toBe('doc-uuid-1');
    const storedRow = mockDocumentsTable.find(r => r.uuid === 'doc-uuid-1')!;
    expect(storedRow).toBeDefined();

    // Verify stored fields in cloud table are encrypted (not plain text)
    expect(storedRow.title).not.toBe('Секретная заметка');
    expect(storedRow.mood).not.toBe('спокойное');
    expect(storedRow.tags).not.toEqual(['личное', 'пароли']);
    expect(typeof storedRow.tags).toBe('string'); // AES-GCM ciphertext
    expect(storedRow._encrypted).toBe(true);

    // Verify reading via DocumentService decrypts back to plain values
    const retrieved = await DocumentService.getDocument(userId, 'doc-uuid-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('Секретная заметка');
    expect(retrieved!.mood).toBe('спокойное');
    expect(retrieved!.tags).toEqual(['личное', 'пароли']);
  });

  it('decrypts all documents when fetching getUserDocuments', async () => {
    await DocumentService.createDocument(userId, {
      title: 'Заметка 1',
      tags: ['тег1'],
      uuid: 'doc-uuid-1',
    });
    await DocumentService.createDocument(userId, {
      title: 'Заметка 2',
      tags: ['тег2'],
      uuid: 'doc-uuid-2',
    });

    const docs = await DocumentService.getUserDocuments(userId);
    expect(docs).toHaveLength(2);
    const titles = docs.map(d => d.title);
    expect(titles).toContain('Заметка 1');
    expect(titles).toContain('Заметка 2');
  });

  it('renames tags across all documents even when tags are encrypted in cloud', async () => {
    await DocumentService.createDocument(userId, {
      title: 'Doc A',
      tags: ['работа', 'проект'],
      uuid: 'doc-a',
    });
    await DocumentService.createDocument(userId, {
      title: 'Doc B',
      tags: ['дом'],
      uuid: 'doc-b',
    });

    // Rename 'работа' -> 'карьера'
    await SupabaseDataProvider.renameTagInAllDocs(userId, 'работа', 'карьера');

    // Retrieve via DocumentService to verify decrypted result
    const docA = await DocumentService.getDocument(userId, 'doc-a');
    expect(docA!.tags).toEqual(['карьера', 'проект']);

    const docB = await DocumentService.getDocument(userId, 'doc-b');
    expect(docB!.tags).toEqual(['дом']);

    // Check cloud stored row is still encrypted
    const rowA = mockDocumentsTable.find(r => r.uuid === 'doc-a')!;
    expect(rowA._encrypted).toBe(true);
    expect(typeof rowA.tags).toBe('string');
  });

  it('removes tags across all documents even when tags are encrypted in cloud', async () => {
    await DocumentService.createDocument(userId, {
      title: 'Doc A',
      tags: ['удалить-меня', 'оставить'],
      uuid: 'doc-a',
    });

    await SupabaseDataProvider.removeTagFromAllDocs(userId, 'удалить-меня');

    const docA = await DocumentService.getDocument(userId, 'doc-a');
    expect(docA!.tags).toEqual(['оставить']);
  });
});
