import { describe, it, expect, vi, beforeEach } from 'vitest';

// NB-12 (sus18): отказ чтения записи портрета не должен выглядеть как
// «портрет не создан» (а) или «портрет свежий» (б). Отказ пробрасывается —
// AuthorPortrait показывает состояние error через LoadState.
// Край — IndexedDB (getLocalDb/get); сервис настоящий.
let currentUid: string | null = 'user-sus18';

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => (currentUid ? { uid: currentUid } : null),
}));
vi.mock('../../../../core/data', () => ({ DataProvider: { getProfile: vi.fn(async () => null) } }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  maybeEncrypt: async (o: unknown) => o,
  maybeDecrypt: async (o: unknown) => o,
}));
vi.mock('../../../../core/services/CloudSyncService', () => ({
  CloudSyncService: { syncPortraitToCloud: vi.fn() },
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const dbGet = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(async () => ({
    get: dbGet,
    getAll: vi.fn(async () => []),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
}));

const { AIProfileService, portraitCacheKey } = await import('../AIProfileService');

describe('sus18: отказ чтения портрета пробрасывается, а не «нет портрета»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    currentUid = 'user-sus18';
    dbGet.mockResolvedValue(undefined);
  });

  it('а: чтение записи IndexedDB упало → getPortrait отклонён', async () => {
    dbGet.mockRejectedValue(new Error('SYNTHETIC_IDB_DOWN'));

    await expect(AIProfileService.getPortrait()).rejects.toThrow('SYNTHETIC_IDB_DOWN');
  });

  it('б: чтение записи IndexedDB упало → isPortraitStale отклонён, а не false', async () => {
    dbGet.mockRejectedValue(new Error('SYNTHETIC_IDB_DOWN'));

    await expect(AIProfileService.isPortraitStale()).rejects.toThrow('SYNTHETIC_IDB_DOWN');
  });

  it('контроль а: запись читается → портрет возвращён', async () => {
    dbGet.mockResolvedValue({ id: 'singleton', portrait: 'Синтетический портрет' });

    expect(await AIProfileService.getPortrait()).toBe('Синтетический портрет');
  });

  it('контроль: IndexedDB пуста (не отказ) → localStorage-кэш по-прежнему читается', async () => {
    localStorage.setItem(portraitCacheKey('user-sus18'), 'портрет из кэша');

    expect(await AIProfileService.getPortrait()).toBe('портрет из кэша');
  });

  it('контроль б: записи нет и кэша нет → не устарел', async () => {
    expect(await AIProfileService.isPortraitStale()).toBe(false);
  });
});