// NB-13 (sus10): переименование/удаление тега — заметку, которую не прочитал
// ключ, пропускали молча, и итог выглядел полным успехом. Провайдер обязан
// вернуть число пропущенных заметок. Харнесс — из auditCleanup.test.ts:
// мок только края (клиент Supabase, криптопомощники), провайдер настоящий.
// Мутация: убрать счётчик skipped (вернуть void/0) — красные а, б.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const builder = {
  select: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
};

vi.mock('../../supabase/client', () => ({
  getSupabase: () => ({ from: () => builder }),
}));

// Край шифрования: строка с _encrypted:true не читается ключом (синтетический
// отказ), нешифрованная проходит как есть.
vi.mock('../../crypto/cryptoHelpers', () => ({
  maybeEncrypt: vi.fn(async (data: Record<string, unknown>) => ({ ...data, _encrypted: false })),
  maybeDecrypt: vi.fn(async (data: Record<string, unknown>) => {
    if (data['_encrypted'] === true) throw new Error('SYNTHETIC_KEY_MISS');
    return data;
  }),
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { SupabaseDataProvider } from '../supabaseDataProvider';
import { reportError } from '../../../shared/errors/reportError';

const rows = [
  { uuid: 'doc_ok', tags: ['old'], _encrypted: false, user_id: 'u1' },
  { uuid: 'doc_bad', tags: ['old'], _encrypted: true, user_id: 'u1' },
];

function wireSelectRows(data: unknown[]) {
  builder.select.mockImplementationOnce(() => ({
    eq: () => ({ is: () => ({ order: () => ({ range: async () => ({ data, error: null }) }) }) }),
  }) as never);
  const res: Record<string, unknown> = {
    eq: () => res,
    is: () => res,
    select: () => res,
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  };
  builder.update.mockImplementation(() => res as never);
}

beforeEach(() => vi.clearAllMocks());

describe('NB-13: пропущенные ключом заметки считаются', () => {
  it('а) rename: одна из двух не прочиталась — возвращает 1, читаемая обновлена', async () => {
    wireSelectRows(rows);
    await expect(SupabaseDataProvider.renameTagInAllDocs('u1', 'old', 'new')).resolves.toBe(1);
    expect(builder.update).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'SYNTHETIC_KEY_MISS' }),
      expect.objectContaining({ action: 'renameTagInAllDocs_decrypt', docUuid: 'doc_bad' }),
    );
  });

  it('б) remove: одна из двух не прочиталась — возвращает 1', async () => {
    wireSelectRows(rows);
    await expect(SupabaseDataProvider.removeTagFromAllDocs('u1', 'old')).resolves.toBe(1);
    expect(builder.update).toHaveBeenCalledTimes(1);
  });

  it('контроль: все заметки читаются — 0 пропущенных', async () => {
    wireSelectRows([rows[0], { uuid: 'doc_ok2', tags: ['old'], _encrypted: false, user_id: 'u1' }]);
    await expect(SupabaseDataProvider.renameTagInAllDocs('u1', 'old', 'new')).resolves.toBe(0);
    expect(builder.update).toHaveBeenCalledTimes(2);
  });
});