// TEST-1: regression tests for data-layer fixes 2.9, 2.10, 2.13, 2.15, 2.16.
// (2.14 and 2.17 are pinned inside VersionService.test.ts and
// supabaseDataProvider.test.ts respectively.)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- Supabase mock shared by the provider-level tests -------------------------
const builder = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockResolvedValue({ data: null, error: null }),
  is: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
};

const clientRpc = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock('../../supabase/client', () => {
  // Full fake: constructing the real client starts a networked session.
  const fake = { from: () => builder };
  const proxy = new Proxy(fake as Record<string, unknown>, {
    get(target, prop) {
      if (prop === 'rpc') return clientRpc;
      if (prop === 'from') return target['from'];
      throw new Error(`unexpected getSupabase().${String(prop)} in test`);
    },
  });
  return { getSupabase: () => proxy } as never;
});

// Теги в фикстурах нешифрованы: криптопомощники должны пропускать как есть,
// а не требовать загруженный профиль (ENCRYPT_REQUIRED в тестовой среде).
vi.mock('../../crypto/cryptoHelpers', () => ({
  maybeEncrypt: vi.fn(async (data: Record<string, unknown>) => ({ ...data, _encrypted: false })),
  maybeDecrypt: vi.fn(async (data: Record<string, unknown>) => data),
}));

import { SupabaseDataProvider } from '../supabaseDataProvider';
import { draftDbSchema } from '../schemas';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('2.9 version ids "v5" parse to numbers, never NaN', () => {
  it('updateVersion filters by numeric 5 for id "v5"', async () => {
    await SupabaseDataProvider.updateVersion('u1', 'doc1', 'v5', { content: 'x' });
    const eqCalls = builder.eq.mock.calls;
    expect(eqCalls).toContainEqual(['version', 5]);
    expect(eqCalls).not.toContainEqual(['version', NaN]);
  });

  it('deleteVersionsBatch parses the whole batch', async () => {
    await SupabaseDataProvider.deleteVersionsBatch('u1', 'doc1', ['v3', '7']);
    expect(builder.in).toHaveBeenCalledWith('version', [3, 7]);
  });
});

describe('2.15 tag operations surface per-document failures', () => {
  const docs = [
    { uuid: 'doc_a', tags: ['old'], _encrypted: false, user_id: 'u1' },
    { uuid: 'doc_b', tags: ['old'], _encrypted: false, user_id: 'u1' },
  ];

  function wireSelectRows(rows: unknown[], updateResults: Array<{ error: unknown }>) {
    builder.select.mockImplementationOnce(() => ({
      eq: () => ({ is: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) }),
    }) as never);
    let call = 0;
    builder.update.mockImplementation(() => {
      const r = updateResults[call] ?? { error: null };
      call++;
      return { eq: () => ({ eq: async () => r }) } as never;
    });
  }

  // N-45: чужая строка в ответе (сломанный RLS) не попадает в обработку тегов.
  it('renameTag skips a row of another account', async () => {
    wireSelectRows([...docs, { uuid: 'doc_foreign', tags: ['old'], _encrypted: false, user_id: 'intruder' }], []);
    await SupabaseDataProvider.renameTagInAllDocs('u1', 'old', 'new');
    expect(builder.update).toHaveBeenCalledTimes(2);
  });

  it('renameTag throws TAG_OP_PARTIAL when one document fails', async () => {
    wireSelectRows(docs, [{ error: null }, { error: { message: 'rls' } }]);
    await expect(SupabaseDataProvider.renameTagInAllDocs('u1', 'old', 'new'))
      .rejects.toThrow('TAG_OP_PARTIAL:1');
  });

  it('removeTag throws TAG_OP_PARTIAL when one document fails', async () => {
    wireSelectRows(docs, [{ error: { message: 'network' } }, { error: null }]);
    await expect(SupabaseDataProvider.removeTagFromAllDocs('u1', 'old'))
      .rejects.toThrow('TAG_OP_PARTIAL:1');
  });

  it('R4-7: a failed read is an error, not a silent success', async () => {
    builder.select.mockImplementationOnce(() => ({
      eq: () => ({ is: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'timeout' } }) }) }) }),
    }) as never);
    await expect(SupabaseDataProvider.removeTagFromAllDocs('u1', 'old')).rejects.toMatchObject({ message: 'timeout' });
  });

  it('all-good updates resolve silently', async () => {
    wireSelectRows(docs, [{ error: null }, { error: null }]);
    await expect(SupabaseDataProvider.renameTagInAllDocs('u1', 'old', 'new')).resolves.toBeUndefined();
  });
});

describe('2.13 cloud draft schema rejects junk before it reaches timers', () => {
  it('content as a number is rejected', () => {
    const parsed = draftDbSchema.safeParse({ userId: 'u1', content: 42 });
    expect(parsed.success).toBe(false);
  });

  it('updatedAt string is normalised to epoch number', () => {
    const parsed = draftDbSchema.safeParse({ userId: 'u1', content: 'ok', updatedAt: '2026-08-22T00:00:00Z' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(typeof parsed.data.updatedAt).toBe('number');
  });

  it('unknown extra keys survive via passthrough (decrypted payload fields)', () => {
    const parsed = draftDbSchema.safeParse({ userId: 'u1', content: 'ok', customFutureField: 1 });
    expect(parsed.success).toBe(true);
  });
});

describe('2.16 applySyncChanges is gone', () => {
  it('the provider no longer exposes it', () => {
    expect((SupabaseDataProvider as unknown as Record<string, unknown>).applySyncChanges).toBeUndefined();
  });
});
