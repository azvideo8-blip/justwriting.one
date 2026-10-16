import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateDocumentSessionStats } from '../providers/documents';

// R7Q-003 / R7F-003: клиент присылал АБСОЛЮТ `sessionsCount`, прочитанный из своей
// копии, и при этом атомарный инкремент пропускался (documents.ts:166). Телефон с
// устаревшей копией уносил облачный счётчик назад, забор раздавал это значение всем
// устройствам, и «N записей» тихонько уменьшалось. Теперь наружу уходит только
// приращение — его складывает `increment_document_sessions` (0020).
type Patch = Record<string, unknown>;
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
const patches: Patch[] = [];

vi.mock('../../supabase/client', () => ({
  getSupabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return { data: null, error: null };
    },
    from: () => ({
      update: (patch: Patch) => {
        patches.push(patch);
        const chain: unknown = {
          eq: () => chain,
          is: () => Promise.resolve({ data: [], error: null }),
          then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
        };
        return chain;
      },
    }),
  }),
}));

describe('R7Q-003: приращение сессий вместо абсолюта', () => {
  beforeEach(() => {
    rpcs.length = 0;
    patches.length = 0;
  });

  it('сколько сессий несёт выгрузка — столько и прибавляется', async () => {
    await updateDocumentSessionStats('u1', 'doc-1', {
      totalWords: 120, durationDelta: 300, currentVersion: 4, sessionsDelta: 3,
    });

    const inc = rpcs.find(r => r.fn === 'increment_document_sessions');
    expect(inc?.args).toMatchObject({ p_uuid: 'doc-1', p_delta: 3 });
    expect(patches).toHaveLength(1);
    expect('sessions_count' in (patches[0] as Patch)).toBe(false);
    expect('sessionsCount' in (patches[0] as Patch)).toBe(false);
  });

  it('нулевая дельта не рисует лишнюю сессию (правка метаданных — не ход)', async () => {
    await updateDocumentSessionStats('u1', 'doc-1', {
      totalWords: 120, durationDelta: 0, currentVersion: 4, sessionsDelta: 0,
    });

    expect(rpcs.some(r => r.fn === 'increment_document_sessions')).toBe(false);
    expect(patches).toHaveLength(1);
  });

  it('без поля дельты — обычный один ход на сохранение', async () => {
    await updateDocumentSessionStats('u1', 'doc-1', {
      totalWords: 120, durationDelta: 60, currentVersion: 5,
    });

    expect(rpcs.find(r => r.fn === 'increment_document_sessions')?.args).toMatchObject({ p_delta: 1 });
  });
});
