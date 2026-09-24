import { describe, it, expect, vi } from 'vitest';
import { getSupabase } from '../../../supabase/client';
import { createDocument } from '../documents';

vi.mock('../../../supabase/client', () => ({ getSupabase: vi.fn() }));
vi.mock('../../../crypto/cryptoHelpers', () => ({ maybeEncrypt: vi.fn(), maybeDecrypt: vi.fn() }));

// R3-7: провайдер удалял надгробие и вставлял заметку заново — удалённая на
// другом устройстве заметка молча возвращалась под прежним номером.
describe('R3-7: createDocument on a tombstoned uuid', () => {
  it('surfaces the 23505 and never deletes the tombstone', async () => {
    const del = vi.fn();
    const from = vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } }),
      delete: del,
      select: vi.fn(() => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { uuid: 'u1', deleted_at: '2026-09-01' } }) }) }) })),
    }));
    vi.mocked(getSupabase).mockReturnValue({ from } as never);

    await expect(createDocument('user1', { uuid: 'u1', content: 'x' })).rejects.toMatchObject({ code: '23505' });
    expect(del).not.toHaveBeenCalled();
  });
});
